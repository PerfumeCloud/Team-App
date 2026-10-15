<?php
declare(strict_types=1);

namespace Club;

/**
 * Web Push (RFC 8030/8291/8292) ohne externe Bibliotheken.
 * Funktioniert mit iPhone (ab iOS 16.4, App auf dem Home-Bildschirm), Mac, Windows und Android.
 */
final class WebPush
{
    private const SPKI_P256_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

    /** VAPID-Schlüssel laden oder beim ersten Mal erzeugen. */
    public static function keys(): array
    {
        $public = Settings::get('vapid_public');
        $private = Settings::getSecret('vapid_private');
        if (is_string($public) && $public !== '' && $private) {
            return ['public' => $public, 'private' => $private];
        }
        [$pem, $raw] = self::generateKeyPair();
        Settings::set('vapid_public', Util::b64url($raw));
        Settings::setSecret('vapid_private', $pem);
        return ['public' => Util::b64url($raw), 'private' => $pem];
    }

    /** @return array{0:string,1:string} [privater PEM-Schlüssel, öffentlicher Punkt (65 Bytes)] */
    public static function generateKeyPair(): array
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if ($key === false) {
            throw new \RuntimeException('EC-Schlüssel konnte nicht erzeugt werden: ' . openssl_error_string());
        }
        openssl_pkey_export($key, $pem);
        return [$pem, self::publicPoint($key)];
    }

    private static function publicPoint(\OpenSSLAsymmetricKey $key): string
    {
        $d = openssl_pkey_get_details($key);
        return "\x04" . str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
    }

    /**
     * Sendet eine Nachricht an ein Abo.
     * status: HTTP-Status des Push-Dienstes (201 = angenommen, 404/410 = Abo gibt es nicht mehr, 0 = keine Verbindung)
     * reason: Antwort des Dienstes bei Fehlern (z. B. „BadJwtToken“ von Apple, „VapidPkHashMismatch“), für die Diagnose
     * @param array{endpoint:string,p256dh:string,auth:string} $sub
     * @return array{status:int, reason:string}
     */
    public static function send(array $sub, array $payload, string $subject, int $ttl = 86400, string $urgency = 'normal'): array
    {
        $keys = self::keys();
        $body = self::encrypt(Util::json($payload), $sub['p256dh'], $sub['auth']);
        $parts = parse_url($sub['endpoint']);
        if (!is_array($parts) || !self::validEndpoint($sub['endpoint'])) {
            return ['status' => 404, 'reason' => 'Ungültige Push-Adresse'];
        }
        $audience = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $jwt = self::vapidJwt($audience, $subject, $keys['private']);

        $ch = curl_init($sub['endpoint']);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER => [
                'Authorization: vapid t=' . $jwt . ', k=' . $keys['public'],
                'Content-Encoding: aes128gcm',
                'Content-Type: application/octet-stream',
                'TTL: ' . $ttl,
                'Urgency: ' . $urgency,
            ],
        ]);
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $reason = '';
        if ($status === 0) {
            $reason = 'Keine Verbindung: ' . curl_error($ch);
            Util::log('Push fehlgeschlagen: ' . $reason);
        } elseif ($status >= 300) {
            $reason = self::reason((string) $response, $status);
        }
        curl_close($ch);
        return ['status' => $status, 'reason' => mb_substr($reason, 0, 240)];
    }

    /** Push-Dienste sind immer https (in den Tests auch ein lokaler Nachbau). */
    public static function validEndpoint(string $url): bool
    {
        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) {
            return false;
        }
        if (($parts['scheme'] ?? '') === 'https') {
            return true;
        }
        return getenv('CLUB_PUSH_TEST') === '1' && ($parts['scheme'] ?? '') === 'http' && $parts['host'] === '127.0.0.1';
    }

    /** Kurze Fehlerbeschreibung aus der Antwort des Push-Dienstes (Apple: {"reason":…}, Google/Mozilla: Text/JSON). */
    private static function reason(string $body, int $status): string
    {
        $data = json_decode($body, true);
        if (is_array($data)) {
            $r = $data['reason'] ?? $data['message'] ?? $data['error']['message'] ?? $data['error'] ?? null;
            if (is_string($r) && $r !== '') {
                return $r;
            }
        }
        $text = trim(strip_tags($body));
        return $text !== '' ? mb_substr($text, 0, 200) : 'HTTP ' . $status;
    }

    public static function vapidJwt(string $audience, string $subject, string $privatePem): string
    {
        $header = Util::b64url(Util::json(['typ' => 'JWT', 'alg' => 'ES256']));
        $claims = Util::b64url(Util::json(['aud' => $audience, 'exp' => time() + 12 * 3600, 'sub' => $subject]));
        $input = $header . '.' . $claims;
        $key = openssl_pkey_get_private($privatePem);
        if (!openssl_sign($input, $der, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('JWT-Signatur fehlgeschlagen.');
        }
        return $input . '.' . Util::b64url(self::derToRaw($der));
    }

    /** ECDSA-Signatur von DER (ASN.1) in das rohe r||s-Format (64 Bytes) umwandeln. */
    private static function derToRaw(string $der): string
    {
        $pos = 2;
        if (ord($der[1]) & 0x80) {
            $pos += ord($der[1]) & 0x7f;
        }
        $out = '';
        for ($i = 0; $i < 2; $i++) {
            $pos++; // INTEGER-Tag
            $len = ord($der[$pos++]);
            $int = substr($der, $pos, $len);
            $pos += $len;
            $int = ltrim($int, "\0");
            $out .= str_pad($int, 32, "\0", STR_PAD_LEFT);
        }
        return $out;
    }

    /** Verschlüsselung nach RFC 8291 (aes128gcm). */
    public static function encrypt(string $payload, string $p256dhB64, string $authB64, ?string $salt = null, ?\OpenSSLAsymmetricKey $ephemeral = null): string
    {
        $uaPublic = Util::b64urlDecode($p256dhB64);
        $authSecret = Util::b64urlDecode($authB64);
        if (strlen($uaPublic) !== 65 || strlen($authSecret) !== 16) {
            throw new \InvalidArgumentException('Ungültiges Push-Abo.');
        }

        $ephemeral ??= openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $asPublic = self::publicPoint($ephemeral);

        $pem = "-----BEGIN PUBLIC KEY-----\n"
            . chunk_split(base64_encode(hex2bin(self::SPKI_P256_PREFIX) . $uaPublic), 64, "\n")
            . "-----END PUBLIC KEY-----\n";
        $peer = openssl_pkey_get_public($pem);
        if ($peer === false) {
            throw new \InvalidArgumentException('Ungültiger Schlüssel im Push-Abo.');
        }
        $shared = openssl_pkey_derive($peer, $ephemeral, 32);
        if ($shared === false) {
            throw new \RuntimeException('ECDH fehlgeschlagen.');
        }

        $salt ??= random_bytes(16);
        $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);

        $tag = '';
        $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
        $header = $salt . pack('N', 4096) . chr(65) . $asPublic;
        return $header . $cipher . $tag;
    }
}
