<?php
declare(strict_types=1);

namespace PC;

/**
 * Signaturen unter Mails aus der App: Text und optional ein Bild (z. B. Logo oder eingescannte Unterschrift).
 * Jede Person hat ihre eigene; Team-Postfächer (info@, support@) bekommen darunter die Fußzeile des Teams,
 * ebenfalls mit Bild. Bilder gehen als eingebettetes Bild (cid:) mit der Mail raus – keine externen Links,
 * die Mailprogramme blockieren könnten.
 */
final class Signature
{
    /** Größe der Bilddatei (die App verkleinert vor dem Hochladen). */
    private const MAX_BYTES = 400_000;
    private const TYPES = [IMAGETYPE_PNG => ['image/png', 'png'], IMAGETYPE_JPEG => ['image/jpeg', 'jpg'], IMAGETYPE_GIF => ['image/gif', 'gif']];
    /** Angezeigte Breite in der Mail (Pixel) */
    public const MIN_WIDTH = 60;
    public const MAX_WIDTH = 600;
    public const DEFAULT_WIDTH = 220;

    private static function dir(): string
    {
        $dir = Config::storageDir() . '/signatures';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
            @file_put_contents($dir . '/.htaccess', "Require all denied\n");
        }
        return $dir;
    }

    /** $owner: Benutzer-ID oder „team“ (Fußzeile der Team-Postfächer). */
    private static function key(string $owner): string
    {
        return 'signature_image_' . ($owner === 'team' ? 'team' : preg_replace('/[^a-f0-9-]/', '', $owner));
    }

    /** @return array{file:string, type:string, w:int, h:int, width:int}|null */
    public static function meta(string $owner): ?array
    {
        $m = Settings::get(self::key($owner));
        return is_array($m) && is_string($m['file'] ?? null) && is_file(self::dir() . '/' . $m['file']) ? $m : null;
    }

    /** Bild als data:-URL (für die Vorschau in der App). */
    public static function dataUrl(string $owner): ?string
    {
        $m = self::meta($owner);
        $raw = $m ? @file_get_contents(self::dir() . '/' . $m['file']) : false;
        return $m && $raw !== false ? 'data:' . $m['type'] . ';base64,' . base64_encode($raw) : null;
    }

    /** Was die App zum Bearbeiten braucht. */
    public static function view(string $owner): array
    {
        $m = self::meta($owner);
        return ['image' => self::dataUrl($owner), 'width' => $m ? (int) $m['width'] : self::DEFAULT_WIDTH];
    }

    /**
     * Bild speichern oder entfernen. $in: image (data:-URL, null = entfernen, fehlt = unverändert), width (Pixel).
     */
    public static function save(string $owner, array $in): array
    {
        $old = self::meta($owner);
        $width = isset($in['width']) ? max(self::MIN_WIDTH, min(self::MAX_WIDTH, (int) $in['width'])) : ($old ? (int) $old['width'] : self::DEFAULT_WIDTH);
        if (array_key_exists('image', $in)) {
            if ($in['image'] === null || $in['image'] === '') {
                self::remove($owner);
                return self::view($owner);
            }
            if (!is_string($in['image']) || !preg_match('#^data:image/(png|jpeg|gif);base64,([A-Za-z0-9+/=\s]+)$#', $in['image'], $m)) {
                throw new HttpError(422, 'Bitte ein Bild als PNG, JPEG oder GIF wählen.');
            }
            $raw = (string) base64_decode($m[2], true);
            if ($raw === '' || strlen($raw) > self::MAX_BYTES) {
                throw new HttpError(413, 'Das Bild ist zu groß (höchstens 400 KB). Bitte ein kleineres Bild wählen.');
            }
            $info = @getimagesizefromstring($raw);
            if (!$info || !isset(self::TYPES[$info[2]])) {
                throw new HttpError(422, 'Das Bild ließ sich nicht lesen. Bitte PNG, JPEG oder GIF wählen.');
            }
            [$type, $ext] = self::TYPES[$info[2]];
            $file = bin2hex(random_bytes(12)) . '.' . $ext;
            if (@file_put_contents(self::dir() . '/' . $file, $raw) === false) {
                throw new HttpError(500, 'Bild konnte nicht gespeichert werden (Ordner storage/signatures nicht beschreibbar).');
            }
            if ($old) {
                @unlink(self::dir() . '/' . $old['file']);
            }
            // Nicht breiter anzeigen als das Bild selbst (sonst wird es unscharf)
            Settings::set(self::key($owner), ['file' => $file, 'type' => $type, 'w' => (int) $info[0], 'h' => (int) $info[1], 'width' => min($width, (int) $info[0])]);
        } elseif ($old) {
            Settings::set(self::key($owner), ['width' => min($width, (int) $old['w'])] + $old);
        }
        return self::view($owner);
    }

    public static function remove(string $owner): void
    {
        $old = self::meta($owner);
        if ($old) {
            @unlink(self::dir() . '/' . $old['file']);
        }
        Settings::delete(self::key($owner));
    }

    /**
     * Signatur-Teil einer Mail: Text (für die Textfassung) und HTML mit eingebetteten Bildern.
     * $teamFooter: Fußzeile des Teams anhängen (Team-Postfächer).
     * @return array{text:string, html:string, inline:array<int, array{cid:string, type:string, name:string, data:string}>}
     */
    public static function block(array $me, bool $teamFooter): array
    {
        $parts = [['text' => Replies::signature($me), 'owner' => (string) $me['id']]];
        if ($teamFooter && Replies::footer() !== '') {
            $parts[] = ['text' => Replies::footer(), 'owner' => 'team'];
        } elseif ($teamFooter && self::meta('team')) {
            $parts[] = ['text' => '', 'owner' => 'team'];
        }
        $text = [];
        $html = [];
        $inline = [];
        foreach ($parts as $i => $p) {
            if ($p['text'] !== '') {
                $text[] = $p['text'];
            }
            $h = $p['text'] !== '' ? '<div>' . self::toHtml($p['text']) . '</div>' : '';
            $m = self::meta($p['owner']);
            $raw = $m ? @file_get_contents(self::dir() . '/' . $m['file']) : false;
            if ($m && $raw !== false) {
                $cid = 'sig' . ($i + 1) . '-' . substr(sha1($m['file']), 0, 10) . '@perfumecloud';
                $height = (int) round((int) $m['h'] * (int) $m['width'] / max(1, (int) $m['w']));
                $h .= '<div style="margin-top:8px"><img src="cid:' . $cid . '" width="' . (int) $m['width'] . '" height="' . $height . '" alt="" style="display:block;border:0;max-width:100%;height:auto"></div>';
                $inline[] = ['cid' => $cid, 'type' => $m['type'], 'name' => ($p['owner'] === 'team' ? 'logo' : 'signatur') . '.' . pathinfo($m['file'], PATHINFO_EXTENSION), 'data' => $raw];
            }
            if ($h !== '') {
                $html[] = $h;
            }
        }
        return ['text' => implode("\n\n", $text), 'html' => implode('<div style="height:14px"></div>', $html), 'inline' => $inline];
    }

    /** Text → HTML: Zeilenumbrüche bleiben, Links und Mailadressen werden anklickbar. */
    public static function toHtml(string $text): string
    {
        $h = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
        $h = (string) preg_replace('#\b(https?://[^\s<]+[^\s<.,;:!?)\]])#u', '<a href="$1" style="color:#80562F">$1</a>', $h);
        $h = (string) preg_replace('#(?<![/\w.@])(www\.[a-z0-9-]+(\.[a-z0-9-]+)+[^\s<]*[^\s<.,;:!?)\]])#iu', '<a href="https://$1" style="color:#80562F">$1</a>', $h);
        return nl2br($h, false);
    }

    /** Ganze Antwort als HTML: Text, Signatur, ggf. Zitat der ursprünglichen Mail. */
    public static function mailHtml(string $bodyText, string $signatureHtml, string $quote = ''): string
    {
        $q = '';
        if ($quote !== '') {
            $lines = explode("\n", $quote);
            $head = array_shift($lines);
            $plain = implode("\n", array_map(static fn ($l) => (string) preg_replace('/^> ?/', '', $l), $lines));
            $q = '<div style="margin-top:22px;color:#555">' . self::toHtml((string) $head)
                . '<blockquote style="margin:6px 0 0;padding-left:12px;border-left:3px solid #CDBFAD;color:#555">' . self::toHtml($plain) . '</blockquote></div>';
        }
        return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
            . '<body style="margin:0;padding:0"><div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#232120">'
            . '<div>' . self::toHtml($bodyText) . '</div>'
            . ($signatureHtml !== '' ? '<div style="margin-top:18px">' . $signatureHtml . '</div>' : '')
            . $q
            . '</div></body></html>';
    }
}
