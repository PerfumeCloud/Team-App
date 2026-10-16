<?php
declare(strict_types=1);

namespace PC;

/**
 * Instagram-Planer: Beiträge vorbereiten, prüfen lassen, freigeben und – bei Bild, Karussell und Story –
 * zur geplanten Zeit automatisch veröffentlichen. Reels (und alles mit „Erinnerung“) postet ihr selbst
 * in der Instagram-App; die Team-App erinnert zur geplanten Zeit und hält Text und Bilder bereit.
 *
 * Bilder liegen in storage/instagram/ und sind nur für angemeldete Personen sichtbar – öffentlich
 * erreichbar (für Instagram, das sie beim Veröffentlichen abholt) nur, solange ein Beitrag freigegeben ist.
 */
final class InstagramPosts
{
    public const KINDS = ['image', 'carousel', 'story', 'reel'];
    public const STATUS_LABELS = [
        'draft' => 'Entwurf',
        'review' => 'Zur Prüfung',
        'approved' => 'Freigegeben',
        'publishing' => 'Wird veröffentlicht',
        'published' => 'Veröffentlicht',
        'failed' => 'Fehlgeschlagen',
    ];
    private const MAX_BYTES = 8 * 1024 * 1024;
    private const DAY = 86400000;

    // ---------- Lesen ----------

    public static function list(array $me): array
    {
        $rows = Db::all(
            "SELECT * FROM ig_posts WHERE deleted = 0 AND (status <> 'published' OR published_at >= ?) ORDER BY COALESCE(scheduled_at, created_at) DESC",
            [Util::now() - 60 * self::DAY]
        );
        $c = Instagram::config();
        return [
            'posts' => array_map(static fn ($p) => self::view($p), $rows),
            'me' => ['id' => $me['id']],
            'four_eyes' => $c['four_eyes'],
            'hashtags' => $c['hashtags'],
            'connected' => Instagram::connected(),
            'username' => Instagram::username(),
            'shopify' => Shopify::configured(),
        ];
    }

    public static function upcoming(): array
    {
        return array_map(static fn ($p) => self::view($p), Db::all(
            "SELECT * FROM ig_posts WHERE deleted = 0 AND status IN ('review', 'approved', 'publishing') ORDER BY COALESCE(scheduled_at, created_at) LIMIT 10"
        ));
    }

    private static function view(array $p): array
    {
        $users = array_column(Db::all('SELECT id, name FROM users'), 'name', 'id');
        $first = static fn (?string $id) => $id && isset($users[$id]) ? explode(' ', (string) $users[$id])[0] : null;
        $images = [];
        foreach (json_decode((string) $p['images'], true) ?: [] as $token) {
            $f = Db::one('SELECT * FROM ig_files WHERE token = ?', [$token]);
            if ($f) {
                $images[] = ['token' => $f['token'], 'url' => '/api/instagram/bild/' . $f['token'] . '.jpg', 'w' => (int) $f['w'], 'h' => (int) $f['h']];
            }
        }
        $metrics = $p['media_id'] ? Db::one('SELECT reach, likes, comments, saved, shares, interactions FROM ig_media WHERE id = ?', [$p['media_id']]) : null;
        return [
            'id' => $p['id'],
            'kind' => $p['kind'],
            'mode' => $p['mode'],
            'caption' => (string) $p['caption'],
            'note' => $p['note'],
            'images' => $images,
            'scheduled_at' => $p['scheduled_at'] !== null ? (int) $p['scheduled_at'] : null,
            'status' => $p['status'],
            'status_label' => $p['status'] === 'approved' && $p['scheduled_at'] && (int) $p['scheduled_at'] > Util::now() ? 'Geplant' : self::STATUS_LABELS[$p['status']] ?? $p['status'],
            'review_note' => $p['review_note'],
            'error' => $p['error'],
            'created_by' => $p['created_by'],
            'created_by_name' => $first($p['created_by']),
            'approved_by_name' => $first($p['approved_by']),
            'published_at' => $p['published_at'] !== null ? (int) $p['published_at'] : null,
            'permalink' => $p['permalink'],
            'source' => $p['source'],
            'metrics' => $metrics,
            'updated_at' => (int) $p['updated_at'],
        ];
    }

    private static function find(string $id): array
    {
        $p = Db::one('SELECT * FROM ig_posts WHERE id = ? AND deleted = 0', [$id]);
        if (!$p) {
            throw new HttpError(404, 'Beitrag nicht gefunden.');
        }
        return $p;
    }

    // ---------- Schreiben ----------

    public static function save(array $me, array $in, ?string $id): array
    {
        $now = Util::now();
        $existing = $id ? self::find($id) : null;
        if ($existing && !in_array($existing['status'], ['draft', 'review', 'approved', 'failed'], true)) {
            throw new HttpError(409, 'Veröffentlichte Beiträge lassen sich hier nicht mehr ändern.');
        }
        $kind = Util::oneOf($in['kind'] ?? null, self::KINDS, $existing['kind'] ?? 'image');
        // Reels lassen sich nur mit Erinnerung planen (das Video kommt aus der Instagram-App)
        $mode = $kind === 'reel' ? 'manual' : Util::oneOf($in['mode'] ?? null, ['auto', 'manual'], $existing['mode'] ?? 'auto');
        $caption = self::caption($in['caption'] ?? ($existing['caption'] ?? ''));
        $row = [
            'kind' => $kind,
            'mode' => $mode,
            'caption' => $caption,
            'note' => array_key_exists('note', $in) ? Util::str($in['note'], 2000) : ($existing['note'] ?? null),
            'scheduled_at' => array_key_exists('scheduled_at', $in) ? self::when($in['scheduled_at']) : ($existing['scheduled_at'] ?? null),
            'updated_at' => $now,
        ];
        if (array_key_exists('images', $in) && is_array($in['images']) && $existing) {
            $row['images'] = Util::json(self::keepImages($existing, $in['images']));
        }
        // Nach einer Änderung muss erneut geprüft werden
        if ($existing && in_array($existing['status'], ['review', 'approved', 'failed'], true)) {
            $row += ['status' => 'draft', 'approved_by' => null, 'approved_at' => null, 'error' => null, 'container_id' => null];
        }
        if ($existing) {
            Db::update('ig_posts', $row, ['id' => $existing['id']]);
            return self::view(self::find($existing['id']));
        }
        $id = Util::uuid();
        Db::insert('ig_posts', $row + [
            'id' => $id,
            'images' => '[]',
            'status' => 'draft',
            'review_note' => null,
            'created_by' => $me['id'],
            'approved_by' => null,
            'approved_at' => null,
            'container_id' => null,
            'media_id' => null,
            'permalink' => null,
            'published_at' => null,
            'error' => null,
            'attempts' => 0,
            'reminded_at' => null,
            'source' => Util::oneOf($in['source'] ?? null, ['team', 'import'], 'team'),
            'created_at' => $now,
            'deleted' => 0,
        ]);
        return self::view(self::find($id));
    }

    private static function caption(mixed $v): string
    {
        $s = Util::str($v, 2200) ?? '';
        if (preg_match_all('/#[\p{L}\p{N}_]+/u', $s) > 30) {
            throw new HttpError(422, 'Instagram erlaubt höchstens 30 Hashtags pro Beitrag.');
        }
        if (preg_match_all('/(^|\s)@[\w.]+/u', $s) > 20) {
            throw new HttpError(422, 'Instagram erlaubt höchstens 20 Erwähnungen (@…) pro Beitrag.');
        }
        return $s;
    }

    private static function when(mixed $v): ?int
    {
        if ($v === null || $v === '' || $v === false) {
            return null;
        }
        $ms = is_numeric($v) ? (int) $v : (int) strtotime((string) $v) * 1000;
        if ($ms <= 0) {
            throw new HttpError(422, 'Ungültiger Zeitpunkt.');
        }
        return $ms;
    }

    /** Reihenfolge übernehmen, nicht mehr aufgeführte Bilder löschen. */
    private static function keepImages(array $post, array $tokens): array
    {
        $current = json_decode((string) $post['images'], true) ?: [];
        $keep = array_values(array_filter(array_map('strval', $tokens), static fn ($t) => in_array($t, $current, true)));
        foreach (array_diff($current, $keep) as $t) {
            self::deleteFile($t);
        }
        return array_values(array_unique($keep));
    }

    public static function delete(string $id): void
    {
        $p = self::find($id);
        if ($p['status'] === 'publishing') {
            throw new HttpError(409, 'Wird gerade veröffentlicht.');
        }
        foreach (json_decode((string) $p['images'], true) ?: [] as $t) {
            self::deleteFile((string) $t);
        }
        Db::update('ig_posts', ['deleted' => 1, 'images' => '[]', 'updated_at' => Util::now()], ['id' => $id]);
    }

    // ---------- Bilder ----------

    private static function dir(): string
    {
        $dir = Config::storageDir() . '/instagram';
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
            @file_put_contents($dir . '/.htaccess', "Require all denied\n");
        }
        return $dir;
    }

    /** JPEG (Instagram nimmt für Bilder nur JPEG) – die App wandelt Fotos vor dem Hochladen um. */
    public static function addImage(string $id, string $raw): array
    {
        $p = self::find($id);
        if (!in_array($p['status'], ['draft', 'failed'], true)) {
            throw new HttpError(409, 'Bilder lassen sich nur bei Entwürfen ändern.');
        }
        $images = json_decode((string) $p['images'], true) ?: [];
        if (count($images) >= 10) {
            throw new HttpError(422, 'Höchstens 10 Bilder pro Beitrag.');
        }
        $token = self::storeJpeg($id, $raw);
        $images[] = $token;
        $kind = $p['kind'] === 'image' && count($images) > 1 ? 'carousel' : $p['kind'];
        Db::update('ig_posts', ['images' => Util::json($images), 'kind' => $kind, 'updated_at' => Util::now()], ['id' => $id]);
        return self::view(self::find($id));
    }

    private static function storeJpeg(string $postId, string $raw): string
    {
        if (strlen($raw) > self::MAX_BYTES) {
            throw new HttpError(413, 'Das Bild ist zu groß (höchstens 8 MB).');
        }
        $info = $raw !== '' ? @getimagesizefromstring($raw) : false;
        if (!$info || $info[2] !== IMAGETYPE_JPEG) {
            $raw = self::toJpeg($raw);
            $info = @getimagesizefromstring($raw);
            if (!$info) {
                throw new HttpError(422, 'Bitte ein Foto als JPEG hochladen.');
            }
        }
        if ($info[0] < 320 || $info[1] < 320) {
            throw new HttpError(422, 'Das Bild ist zu klein (mindestens 320 Pixel breit und hoch).');
        }
        $token = bin2hex(random_bytes(16));
        if (@file_put_contents(self::dir() . "/$token.jpg", $raw) === false) {
            throw new HttpError(500, 'Bild konnte nicht gespeichert werden (Ordner storage/instagram nicht beschreibbar).');
        }
        Db::insert('ig_files', ['token' => $token, 'post_id' => $postId, 'w' => (int) $info[0], 'h' => (int) $info[1], 'bytes' => strlen($raw), 'created_at' => Util::now()]);
        return $token;
    }

    /** PNG/WebP aus Shopify in JPEG umwandeln – nur, wenn der Server GD hat. */
    private static function toJpeg(string $raw): string
    {
        if (!function_exists('imagecreatefromstring') || $raw === '') {
            throw new HttpError(422, 'Bitte ein Foto als JPEG hochladen.');
        }
        $img = @imagecreatefromstring($raw);
        if (!$img) {
            throw new HttpError(422, 'Das Bild ließ sich nicht lesen. Bitte als JPEG hochladen.');
        }
        $w = imagesx($img);
        $h = imagesy($img);
        $out = imagecreatetruecolor($w, $h);
        imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));
        imagecopy($out, $img, 0, 0, 0, 0, $w, $h);
        ob_start();
        imagejpeg($out, null, 90);
        return (string) ob_get_clean();
    }

    private static function deleteFile(string $token): void
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
            return;
        }
        @unlink(self::dir() . "/$token.jpg");
        Db::exec('DELETE FROM ig_files WHERE token = ?', [$token]);
    }

    /**
     * Bild ausliefern: angemeldet mit Instagram-Zugang immer, sonst (Instagram holt das Bild ab)
     * nur, solange der Beitrag freigegeben ist oder gerade veröffentlicht wird.
     */
    public static function serve(string $token): void
    {
        $f = Db::one('SELECT f.token, p.status FROM ig_files f LEFT JOIN ig_posts p ON p.id = f.post_id AND p.deleted = 0 WHERE f.token = ?', [$token]);
        $user = Auth::user();
        $public = $f && in_array($f['status'], ['approved', 'publishing'], true);
        $file = self::dir() . "/$token.jpg";
        if (!$f || !is_file($file) || (!$public && !($user && Instagram::access($user)))) {
            throw new HttpError(404, 'Bild nicht gefunden.');
        }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($file));
        header('Cache-Control: ' . ($public ? 'public, max-age=600' : 'private, max-age=86400'));
        header('X-Content-Type-Options: nosniff');
        readfile($file);
    }

    // ---------- Produkte aus Shopify (Bilder und Texte als Vorlage) ----------

    public static function products(): array
    {
        if (!Shopify::configured()) {
            return ['products' => []];
        }
        $cached = Settings::get('instagram_products');
        if (is_array($cached) && (int) ($cached['at'] ?? 0) > Util::now() - 15 * 60000) {
            return ['products' => $cached['products']];
        }
        $d = Shopify::graphql('query {
            products(first: 80, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
                nodes {
                    id title handle onlineStoreUrl description(truncateAt: 400)
                    priceRangeV2 { minVariantPrice { amount } }
                    media(first: 8) { nodes { ... on MediaImage { image { url width height altText } } } }
                }
            }
        }');
        $out = [];
        foreach ($d['products']['nodes'] ?? [] as $p) {
            $images = [];
            foreach ($p['media']['nodes'] ?? [] as $m) {
                if (!empty($m['image']['url'])) {
                    $images[] = ['url' => (string) $m['image']['url'], 'w' => (int) ($m['image']['width'] ?? 0), 'h' => (int) ($m['image']['height'] ?? 0)];
                }
            }
            $out[] = [
                'id' => Shopify::numericId((string) $p['id']),
                'title' => (string) $p['title'],
                'handle' => (string) $p['handle'],
                'url' => (string) ($p['onlineStoreUrl'] ?? ''),
                'description' => trim((string) ($p['description'] ?? '')),
                'price' => isset($p['priceRangeV2']['minVariantPrice']['amount']) ? (int) round((float) $p['priceRangeV2']['minVariantPrice']['amount'] * 100) : null,
                'images' => $images,
            ];
        }
        Settings::set('instagram_products', ['at' => Util::now(), 'products' => $out]);
        return ['products' => $out];
    }

    /** Nur Bilder aus dem Shopify-CDN (kein beliebiger Abruf fremder Adressen). */
    public static function fetchShopifyImage(string $url): array
    {
        $parts = parse_url($url);
        if (($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') !== 'cdn.shopify.com' || !str_starts_with((string) ($parts['path'] ?? ''), '/s/files/')) {
            throw new HttpError(422, 'Nur Produktbilder aus Shopify.');
        }
        // Breite begrenzen (das Shopify-CDN skaliert selbst)
        $url .= (str_contains($url, '?') ? '&' : '?') . 'width=1440';
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXFILESIZE => 15 * 1024 * 1024, CURLOPT_USERAGENT => 'PerfumeCloudTeamApp/' . APP_VERSION]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        if ($raw === false || $status !== 200 || !str_starts_with($type, 'image/')) {
            throw new HttpError(502, 'Produktbild konnte nicht geladen werden.');
        }
        return ['type' => $type, 'raw' => (string) $raw];
    }

    // ---------- Ablauf: prüfen, freigeben, veröffentlichen ----------

    public static function action(array $me, string $id, string $action, array $in): array
    {
        $p = self::find($id);
        $now = Util::now();
        $fourEyes = Instagram::config()['four_eyes'];
        switch ($action) {
            case 'submit':
                self::require($p, ['draft', 'failed']);
                self::validate($p);
                Db::update('ig_posts', ['status' => 'review', 'review_note' => null, 'error' => null, 'updated_at' => $now], ['id' => $id]);
                $others = array_values(array_filter(self::people(), static fn ($u) => $u['id'] !== $me['id']));
                Notify::users(array_column($others, 'id'), 'instagram', [
                    'title' => 'Instagram-Beitrag zur Prüfung',
                    'body' => explode(' ', (string) $me['name'])[0] . ': ' . self::snippet($p),
                    'url' => '/instagram/planung',
                    'tag' => 'ig-review-' . $id,
                ]);
                break;
            case 'approve':
                // Ohne Vier-Augen-Prinzip direkt aus dem Entwurf freigeben
                self::require($p, $fourEyes ? ['review'] : ['draft', 'review', 'failed']);
                if ($fourEyes && $p['created_by'] === $me['id']) {
                    throw new HttpError(403, 'Vier-Augen-Prinzip: Freigeben muss jemand anderes als die Person, die den Beitrag vorbereitet hat.');
                }
                self::validate($p);
                if ($p['mode'] === 'auto' && !Instagram::connected()) {
                    throw new HttpError(409, 'Instagram ist nicht verbunden – automatisch veröffentlichen geht erst danach.');
                }
                Db::update('ig_posts', ['status' => 'approved', 'approved_by' => $me['id'], 'approved_at' => $now, 'error' => null, 'reminded_at' => null, 'updated_at' => $now], ['id' => $id]);
                Activity::log($me['id'], 'instagram', 'instagram', $id, 'hat einen Instagram-Beitrag freigegeben: ' . self::snippet($p));
                if ($p['created_by'] && $p['created_by'] !== $me['id']) {
                    Notify::users([$p['created_by']], 'instagram', [
                        'title' => 'Instagram-Beitrag freigegeben',
                        'body' => self::snippet($p) . ($p['scheduled_at'] && (int) $p['scheduled_at'] > $now ? ' · geplant für ' . date('d.m. H:i', intdiv((int) $p['scheduled_at'], 1000)) : ''),
                        'url' => '/instagram/planung',
                        'tag' => 'ig-approved-' . $id,
                    ]);
                }
                // Sofort fällig → gleich veröffentlichen (dauert ein paar Sekunden)
                if ($p['mode'] === 'auto' && (!$p['scheduled_at'] || (int) $p['scheduled_at'] <= $now + 60000)) {
                    self::publish(self::find($id));
                }
                break;
            case 'reject':
                self::require($p, ['review']);
                $note = Util::str($in['note'] ?? '', 500);
                Db::update('ig_posts', ['status' => 'draft', 'review_note' => $note ? explode(' ', (string) $me['name'])[0] . ': ' . $note : null, 'updated_at' => $now], ['id' => $id]);
                if ($p['created_by'] && $p['created_by'] !== $me['id']) {
                    Notify::users([$p['created_by']], 'instagram', [
                        'title' => 'Instagram-Beitrag zurückgegeben',
                        'body' => $note ?: self::snippet($p),
                        'url' => '/instagram/planung',
                        'tag' => 'ig-review-' . $id,
                    ]);
                }
                break;
            case 'cancel':
                self::require($p, ['review', 'approved', 'failed']);
                Db::update('ig_posts', ['status' => 'draft', 'approved_by' => null, 'approved_at' => null, 'container_id' => null, 'updated_at' => $now], ['id' => $id]);
                break;
            case 'retry':
                self::require($p, ['failed']);
                Db::update('ig_posts', ['status' => 'approved', 'error' => null, 'attempts' => 0, 'updated_at' => $now], ['id' => $id]);
                if ($p['mode'] === 'auto') {
                    self::publish(self::find($id));
                }
                break;
            case 'done':
                // Selbst in der Instagram-App gepostet (Reel oder „Erinnerung“)
                self::require($p, ['approved', 'draft', 'review']);
                if ($p['mode'] !== 'manual') {
                    throw new HttpError(409, 'Dieser Beitrag wird automatisch veröffentlicht.');
                }
                $link = Util::str($in['permalink'] ?? '', 300);
                if ($link !== null && !preg_match('#^https://(www\.)?instagram\.com/#', $link)) {
                    throw new HttpError(422, 'Bitte den Link zum Beitrag auf instagram.com einfügen (oder leer lassen).');
                }
                Db::update('ig_posts', ['status' => 'published', 'published_at' => $now, 'permalink' => $link, 'updated_at' => $now], ['id' => $id]);
                Activity::log($me['id'], 'instagram', 'instagram', $id, 'hat einen Beitrag auf Instagram gepostet: ' . self::snippet($p));
                break;
            default:
                throw new HttpError(404, 'Unbekannte Aktion.');
        }
        return self::view(self::find($id));
    }

    private static function require(array $p, array $states): void
    {
        if (!in_array($p['status'], $states, true)) {
            throw new HttpError(409, 'Das geht im Status „' . (self::STATUS_LABELS[$p['status']] ?? $p['status']) . '“ nicht.');
        }
    }

    /** Was Instagram verlangt, vorab prüfen – damit die Freigabe nicht erst beim Veröffentlichen scheitert. */
    private static function validate(array $p): void
    {
        $images = Db::all('SELECT * FROM ig_files WHERE post_id = ?', [$p['id']]);
        $tokens = json_decode((string) $p['images'], true) ?: [];
        $byToken = array_column($images, null, 'token');
        $list = array_values(array_filter(array_map(static fn ($t) => $byToken[$t] ?? null, $tokens)));
        if ($p['kind'] !== 'reel' && $p['kind'] !== 'story' && trim((string) $p['caption']) === '' && $p['mode'] === 'auto') {
            throw new HttpError(422, 'Bitte einen Text für den Beitrag schreiben.');
        }
        if ($p['mode'] === 'manual') {
            return;
        }
        $n = count($list);
        if ($p['kind'] === 'image' && $n !== 1) {
            throw new HttpError(422, $n ? 'Ein Bild-Beitrag hat genau ein Bild – mit mehreren wird es ein Karussell.' : 'Bitte ein Bild hinzufügen.');
        }
        if ($p['kind'] === 'carousel' && ($n < 2 || $n > 10)) {
            throw new HttpError(422, 'Ein Karussell braucht 2 bis 10 Bilder.');
        }
        if ($p['kind'] === 'story' && $n !== 1) {
            throw new HttpError(422, 'Eine Story hat genau ein Bild.');
        }
        if ($p['kind'] !== 'story') {
            foreach ($list as $i => $f) {
                $ratio = (int) $f['w'] / max(1, (int) $f['h']);
                if ($ratio < 0.79 || $ratio > 1.92) {
                    throw new HttpError(422, 'Bild ' . ($i + 1) . ' hat ein Format, das Instagram im Feed nicht annimmt (erlaubt: von Hochformat 4:5 bis Querformat 1,91:1). Bitte zuschneiden.');
                }
            }
        }
    }

    /** Aus dem Cronjob: fällige Beiträge veröffentlichen, an selbst zu postende erinnern. */
    public static function due(): string
    {
        $now = Util::now();
        $out = [];
        $rows = Db::all(
            "SELECT * FROM ig_posts WHERE deleted = 0 AND mode = 'auto' AND ((status = 'approved' AND (scheduled_at IS NULL OR scheduled_at <= ?)) OR (status = 'publishing' AND updated_at < ?)) ORDER BY scheduled_at LIMIT 3",
            [$now, $now - 3 * 60000]
        );
        foreach ($rows as $p) {
            $r = self::publish($p);
            $out[] = $r['status'] === 'published' ? 'veröffentlicht' : ($r['status'] === 'failed' ? 'fehlgeschlagen' : 'wird verarbeitet');
        }
        foreach (Db::all("SELECT * FROM ig_posts WHERE deleted = 0 AND mode = 'manual' AND status = 'approved' AND scheduled_at IS NOT NULL AND scheduled_at <= ? AND reminded_at IS NULL", [$now]) as $p) {
            Db::update('ig_posts', ['reminded_at' => $now], ['id' => $p['id']]);
            $to = array_values(array_unique(array_filter([$p['created_by'], $p['approved_by']])));
            Notify::users($to, 'instagram', [
                'title' => 'Jetzt auf Instagram posten' . ($p['kind'] === 'reel' ? ' (Reel)' : ''),
                'body' => self::snippet($p) . ' · Text und Bilder liegen im Planer bereit.',
                'url' => '/instagram/planung',
                'tag' => 'ig-remind-' . $p['id'],
            ]);
            $out[] = 'Erinnerung';
        }
        return $out ? 'Instagram: ' . implode(', ', $out) : '–';
    }

    /**
     * Veröffentlichen: Container anlegen (Instagram holt die Bilder ab), auf „fertig“ warten, veröffentlichen.
     * Ist der Container noch nicht fertig, macht der nächste Cronjob-Lauf weiter.
     */
    public static function publish(array $p): array
    {
        $now = Util::now();
        // Gegen doppeltes Veröffentlichen: nur wer den Status umstellt, macht weiter
        $claimed = Db::exec(
            "UPDATE ig_posts SET status = 'publishing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND (status = 'approved' OR (status = 'publishing' AND updated_at < ?))",
            [$now, $p['id'], $now - 3 * 60000]
        );
        if ($claimed !== 1) {
            return self::view(self::find($p['id']));
        }
        @set_time_limit(120);
        $account = Instagram::accountId();
        try {
            $container = (string) ($p['container_id'] ?? '');
            if ($container !== '') {
                $state = Instagram::get('/' . $container, ['fields' => 'status_code,status']);
                if (($state['status_code'] ?? '') === 'PUBLISHED') {
                    // Schon veröffentlicht (z. B. Zeitüberschreitung beim letzten Mal) – Beitrag wird beim Abgleich verknüpft
                    return self::published($p, null, null);
                }
                if (in_array($state['status_code'] ?? '', ['ERROR', 'EXPIRED'], true)) {
                    $container = '';
                }
            }
            if ($container === '') {
                $urls = array_map(static fn ($t) => Util::baseUrl() . '/api/instagram/bild/' . $t . '.jpg', json_decode((string) $p['images'], true) ?: []);
                if ($p['kind'] === 'carousel') {
                    $children = [];
                    foreach ($urls as $u) {
                        $children[] = (string) Instagram::post("/$account/media", ['image_url' => $u, 'is_carousel_item' => 'true'])['id'];
                    }
                    $c = Instagram::post("/$account/media", ['media_type' => 'CAROUSEL', 'children' => implode(',', $children), 'caption' => (string) $p['caption']]);
                } elseif ($p['kind'] === 'story') {
                    $c = Instagram::post("/$account/media", ['media_type' => 'STORIES', 'image_url' => $urls[0] ?? '']);
                } else {
                    $c = Instagram::post("/$account/media", ['image_url' => $urls[0] ?? '', 'caption' => (string) $p['caption']]);
                }
                $container = (string) ($c['id'] ?? '');
                if ($container === '') {
                    throw new \RuntimeException('Instagram hat keinen Container angelegt.');
                }
                Db::update('ig_posts', ['container_id' => $container, 'updated_at' => Util::now()], ['id' => $p['id']]);
            }
            // Warten, bis Instagram die Bilder verarbeitet hat (bei Fotos meist sofort)
            $ready = false;
            for ($i = 0; $i < 8; $i++) {
                $state = Instagram::get('/' . $container, ['fields' => 'status_code,status']);
                $code = (string) ($state['status_code'] ?? '');
                if ($code === 'FINISHED') {
                    $ready = true;
                    break;
                }
                if ($code === 'ERROR' || $code === 'EXPIRED') {
                    Db::update('ig_posts', ['container_id' => null], ['id' => $p['id']]);
                    throw new \RuntimeException('Instagram konnte die Bilder nicht verarbeiten' . (!empty($state['status']) ? ': ' . $state['status'] : '') . '.', 9000);
                }
                usleep($i < 3 ? 1000000 : 2500000);
            }
            if (!$ready) {
                return self::view(self::find($p['id']));
            }
            $r = Instagram::post("/$account/media_publish", ['creation_id' => $container]);
            $mediaId = (string) ($r['id'] ?? '');
            $link = null;
            if ($mediaId !== '') {
                try {
                    $link = Instagram::get('/' . $mediaId, ['fields' => 'permalink'])['permalink'] ?? null;
                } catch (\Throwable) {
                    // Link kommt dann mit dem nächsten Abgleich
                }
            }
            return self::published($p, $mediaId ?: null, $link);
        } catch (\Throwable $e) {
            $attempts = (int) $p['attempts'] + 1;
            // Netz- und Lastprobleme: im nächsten Lauf noch einmal (höchstens 3 Versuche)
            $transient = in_array($e->getCode(), [-1, 1, 2, 4, 17, 32, 613], true);
            $failed = !$transient || $attempts >= 3;
            Db::update('ig_posts', [
                'status' => $failed ? 'failed' : 'approved',
                'error' => mb_substr($e->getMessage(), 0, 500),
                'updated_at' => Util::now(),
            ], ['id' => $p['id']]);
            Util::log('Instagram veröffentlichen: ' . $e->getMessage());
            if ($failed) {
                Notify::users(array_values(array_unique(array_filter([$p['created_by'], $p['approved_by']]))), 'instagram', [
                    'title' => 'Instagram-Beitrag nicht veröffentlicht',
                    'body' => mb_substr($e->getMessage(), 0, 140),
                    'url' => '/instagram/planung',
                    'tag' => 'ig-failed-' . $p['id'],
                ]);
            }
            return self::view(self::find($p['id']));
        }
    }

    private static function published(array $p, ?string $mediaId, ?string $link): array
    {
        $now = Util::now();
        Db::update('ig_posts', ['status' => 'published', 'media_id' => $mediaId, 'permalink' => $link, 'published_at' => $now, 'error' => null, 'updated_at' => $now], ['id' => $p['id']]);
        Activity::log($p['approved_by'], 'instagram', 'instagram', $p['id'], 'Auf Instagram veröffentlicht: ' . self::snippet($p));
        Notify::users(array_values(array_unique(array_filter([$p['created_by'], $p['approved_by']]))), 'instagram', [
            'title' => 'Auf Instagram veröffentlicht',
            'body' => self::snippet($p),
            'url' => '/instagram/planung',
            'tag' => 'ig-published-' . $p['id'],
        ]);
        // Beim nächsten Cronjob-Lauf abgleichen (verknüpft den Beitrag und holt erste Zahlen)
        Settings::set('instagram_sync_due', true);
        return self::view(self::find($p['id']));
    }

    /** Selbst gepostete und veröffentlichte Beiträge mit dem Beitrag auf Instagram verknüpfen (für die Zahlen). */
    public static function linkPublished(): void
    {
        $rows = Db::all("SELECT * FROM ig_posts WHERE deleted = 0 AND status = 'published' AND media_id IS NULL AND published_at >= ?", [Util::now() - 14 * self::DAY]);
        foreach ($rows as $p) {
            $start = self::norm((string) $p['caption']);
            $m = null;
            if ($p['permalink']) {
                $m = Db::one('SELECT id, permalink FROM ig_media WHERE permalink = ?', [$p['permalink']]);
            }
            if (!$m && $start !== '') {
                foreach (Db::all('SELECT id, caption, permalink FROM ig_media WHERE posted_at >= ? ORDER BY posted_at DESC', [(int) $p['published_at'] - self::DAY]) as $c) {
                    if (self::norm((string) $c['caption']) === $start) {
                        $m = $c;
                        break;
                    }
                }
            }
            if ($m) {
                Db::update('ig_posts', ['media_id' => $m['id'], 'permalink' => $p['permalink'] ?: $m['permalink']], ['id' => $p['id']]);
            }
        }
    }

    private static function norm(string $caption): string
    {
        return mb_substr((string) preg_replace('/\s+/u', ' ', mb_strtolower(trim($caption))), 0, 60);
    }

    private static function snippet(array $p): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', (string) $p['caption']));
        $label = ['image' => 'Bild', 'carousel' => 'Karussell', 'story' => 'Story', 'reel' => 'Reel'][$p['kind']] ?? 'Beitrag';
        return $text !== '' ? (mb_strlen($text) > 70 ? mb_substr($text, 0, 68) . '…' : $text) : $label;
    }

    /** Personen mit Instagram-Zugang. */
    private static function people(): array
    {
        return array_values(array_filter(Db::all('SELECT * FROM users WHERE deleted = 0'), static fn ($u) => Instagram::access($u)));
    }

    // ---------- Entwürfe importieren (z. B. von Claude vorbereitet) ----------

    public static function import(array $me, array $in): array
    {
        $list = is_array($in['posts'] ?? null) ? $in['posts'] : [];
        if (!$list || count($list) > 30) {
            throw new HttpError(422, 'Die Datei enthält keine Beiträge (oder mehr als 30).');
        }
        $products = null;
        $created = 0;
        $notes = [];
        foreach ($list as $i => $x) {
            if (!is_array($x)) {
                continue;
            }
            $when = null;
            try {
                $when = isset($x['scheduled_at']) ? self::when($x['scheduled_at']) : null;
            } catch (HttpError) {
                $notes[] = 'Beitrag ' . ($i + 1) . ': Zeitpunkt nicht erkannt';
            }
            $post = self::save($me, [
                'kind' => $x['kind'] ?? 'image',
                'mode' => $x['mode'] ?? null,
                'caption' => $x['caption'] ?? '',
                'note' => $x['note'] ?? null,
                // Vorgeschlagene Zeit nur, wenn sie noch in der Zukunft liegt
                'scheduled_at' => $when !== null && $when > Util::now() ? $when : null,
                'source' => 'import',
            ], null);
            $created++;
            $urls = is_array($x['images'] ?? null) ? array_values(array_filter($x['images'], 'is_string')) : [];
            if (!$urls && !empty($x['product'])) {
                $products ??= self::products()['products'];
                foreach ($products as $p) {
                    if ($p['handle'] === $x['product'] || mb_strtolower($p['title']) === mb_strtolower((string) $x['product'])) {
                        $urls = array_slice(array_column($p['images'], 'url'), 0, $post['kind'] === 'carousel' ? 5 : 1);
                        break;
                    }
                }
            }
            foreach (array_slice($urls, 0, 10) as $u) {
                try {
                    $img = self::fetchShopifyImage($u);
                    $images = json_decode((string) self::find($post['id'])['images'], true) ?: [];
                    $images[] = self::storeJpeg($post['id'], $img['raw']);
                    Db::update('ig_posts', ['images' => Util::json($images)], ['id' => $post['id']]);
                } catch (\Throwable $e) {
                    $notes[] = 'Beitrag ' . ($i + 1) . ': Bild nicht übernommen (' . $e->getMessage() . ')';
                }
            }
            $count = count(json_decode((string) self::find($post['id'])['images'], true) ?: []);
            if ($post['kind'] === 'image' && $count > 1) {
                Db::update('ig_posts', ['kind' => 'carousel'], ['id' => $post['id']]);
            }
        }
        return ['created' => $created, 'notes' => $notes] + self::list($me);
    }

    // ---------- Kommentare ----------

    /** Kommentare der Beiträge der letzten 30 Tage holen. @return int neue Kommentare */
    public static function syncComments(): int
    {
        $own = mb_strtolower(Instagram::username());
        $media = Db::all("SELECT id FROM ig_media WHERE posted_at >= ? AND comments > 0 AND product_type <> 'STORY' ORDER BY posted_at DESC LIMIT 15", [Util::now() - 30 * self::DAY]);
        $new = [];
        $now = Util::now();
        foreach ($media as $m) {
            $r = Instagram::get('/' . $m['id'] . '/comments', ['fields' => 'id,text,username,timestamp,like_count,replies{id,username,timestamp}', 'limit' => 50]);
            foreach ($r['data'] ?? [] as $c) {
                $user = (string) ($c['username'] ?? '');
                if (empty($c['id']) || mb_strtolower($user) === $own) {
                    continue;
                }
                $replied = false;
                foreach ($c['replies']['data'] ?? [] as $rep) {
                    if (mb_strtolower((string) ($rep['username'] ?? '')) === $own) {
                        $replied = true;
                    }
                }
                $row = Db::one('SELECT * FROM ig_comments WHERE id = ?', [$c['id']]);
                if ($row) {
                    Db::update('ig_comments', ['likes' => (int) ($c['like_count'] ?? 0), 'replied' => $replied || (int) $row['replied'] === 1 ? 1 : 0, 'synced_at' => $now], ['id' => $c['id']]);
                    continue;
                }
                $at = isset($c['timestamp']) ? (int) strtotime((string) $c['timestamp']) * 1000 : $now;
                Db::insert('ig_comments', [
                    'id' => (string) $c['id'],
                    'media_id' => (string) $m['id'],
                    'username' => mb_substr($user, 0, 100),
                    'text' => mb_substr((string) ($c['text'] ?? ''), 0, 2200),
                    'at' => $at,
                    'likes' => (int) ($c['like_count'] ?? 0),
                    'replied' => $replied ? 1 : 0,
                    'done' => 0,
                    'replied_by' => null,
                    'synced_at' => $now,
                ]);
                // Beim allerersten Abgleich keine Flut an Push-Nachrichten
                if (!$replied && $at > $now - 2 * self::DAY && Settings::get('instagram_comments_seen')) {
                    $new[] = ['user' => $user, 'text' => (string) ($c['text'] ?? '')];
                }
            }
        }
        Settings::set('instagram_comments_seen', true);
        if ($new) {
            Notify::users(array_column(self::people(), 'id'), 'instagram', [
                'title' => count($new) === 1 ? 'Neuer Kommentar auf Instagram' : count($new) . ' neue Kommentare auf Instagram',
                'body' => '@' . $new[0]['user'] . ': ' . mb_substr($new[0]['text'], 0, 100),
                'url' => '/instagram/kommentare',
                'tag' => 'ig-comments',
            ]);
        }
        return count($new);
    }

    public static function unansweredCount(): int
    {
        return (int) Db::value('SELECT COUNT(*) FROM ig_comments WHERE replied = 0 AND done = 0 AND at >= ?', [Util::now() - 30 * self::DAY]);
    }

    public static function comments(): array
    {
        $rows = Db::all(
            'SELECT c.*, m.caption, m.permalink, m.thumbnail_url, m.media_url, m.media_type FROM ig_comments c LEFT JOIN ig_media m ON m.id = c.media_id WHERE c.at >= ? ORDER BY (c.replied = 0 AND c.done = 0) DESC, c.at DESC LIMIT 150',
            [Util::now() - 30 * self::DAY]
        );
        $users = array_column(Db::all('SELECT id, name FROM users'), 'name', 'id');
        return [
            'comments' => array_map(static fn ($c) => [
                'id' => $c['id'],
                'username' => $c['username'],
                'text' => $c['text'],
                'at' => (int) $c['at'],
                'likes' => (int) $c['likes'],
                'open' => (int) $c['replied'] === 0 && (int) $c['done'] === 0,
                'replied' => (int) $c['replied'] === 1,
                'replied_by' => $c['replied_by'] && isset($users[$c['replied_by']]) ? explode(' ', (string) $users[$c['replied_by']])[0] : null,
                'post' => ['caption' => mb_substr((string) $c['caption'], 0, 120), 'permalink' => $c['permalink'], 'thumb' => $c['thumbnail_url'] ?: ($c['media_type'] === 'VIDEO' ? null : $c['media_url'])],
            ], $rows),
            'unanswered' => self::unansweredCount(),
            'username' => Instagram::username(),
        ];
    }

    public static function reply(array $me, string $id, array $in): array
    {
        $c = Db::one('SELECT * FROM ig_comments WHERE id = ?', [$id]);
        if (!$c) {
            throw new HttpError(404, 'Kommentar nicht gefunden.');
        }
        $text = Util::str($in['text'] ?? '', 2200) ?? '';
        if ($text === '') {
            throw new HttpError(422, 'Bitte eine Antwort schreiben.');
        }
        try {
            Instagram::post('/' . $id . '/replies', ['message' => $text]);
        } catch (\RuntimeException $e) {
            throw new HttpError(502, $e->getMessage());
        }
        Db::update('ig_comments', ['replied' => 1, 'replied_by' => $me['id']], ['id' => $id]);
        Activity::log($me['id'], 'instagram', 'instagram', null, 'hat auf Instagram @' . $c['username'] . ' geantwortet');
        return self::comments();
    }

    public static function markDone(string $id, bool $done): array
    {
        Db::update('ig_comments', ['done' => $done ? 1 : 0], ['id' => $id]);
        return self::comments();
    }

    /** Täglich: alte Kommentare (Daten Dritter) nach 90 Tagen löschen, Bilder veröffentlichter Beiträge nach 30 Tagen. */
    public static function cleanup(): void
    {
        $now = Util::now();
        Db::exec('DELETE FROM ig_comments WHERE at < ?', [$now - 90 * self::DAY]);
        $old = Db::all("SELECT f.token FROM ig_files f LEFT JOIN ig_posts p ON p.id = f.post_id WHERE p.id IS NULL OR p.deleted = 1 OR (p.status = 'published' AND p.published_at < ?)", [$now - 30 * self::DAY]);
        foreach ($old as $f) {
            self::deleteFile((string) $f['token']);
        }
    }
}
