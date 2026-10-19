<?php
declare(strict_types=1);

namespace PC;

/**
 * Kopie der Datensicherung in einen S3-kompatiblen Speicher außerhalb des Servers, z. B. Cloudflare R2
 * (10 GB kostenlos), Hetzner Object Storage oder AWS S3. Ohne Bibliothek: Anfragen signiert mit AWS Signature
 * Version 4 – die ältere Version 2 nehmen R2 und Hetzner nicht an.
 *
 * Einstellungen: backup_s3 (endpoint, region, bucket, prefix, access_key, on), Geheimnis backup_s3_secret.
 * Die Dateien sind schon verschlüsselt (siehe Backup), der Speicher sieht nur unlesbare Daten.
 */
final class S3
{
    public static function config(): array
    {
        $c = Settings::get('backup_s3');
        $c = is_array($c) ? $c : [];
        return [
            'on' => !empty($c['on']),
            'endpoint' => (string) ($c['endpoint'] ?? ''),
            'region' => (string) ($c['region'] ?? 'auto'),
            'bucket' => (string) ($c['bucket'] ?? ''),
            'prefix' => (string) ($c['prefix'] ?? 'team-app'),
            'access_key' => (string) ($c['access_key'] ?? ''),
        ];
    }

    public static function configured(): bool
    {
        $c = self::config();
        return $c['endpoint'] !== '' && $c['bucket'] !== '' && $c['access_key'] !== '' && Settings::getSecret('backup_s3_secret') !== null;
    }

    /** Für die Einstellungen (Geheimnis nie). */
    public static function status(): array
    {
        return self::config() + ['hasSecret' => Settings::getSecret('backup_s3_secret') !== null, 'last' => Settings::get('backup_s3_last')];
    }

    public static function save(array $in): array
    {
        $c = self::config();
        if (array_key_exists('endpoint', $in)) {
            $e = rtrim(trim((string) $in['endpoint']), '/');
            if ($e !== '' && !preg_match('#^https://[a-z0-9.-]+(:\d+)?$#i', $e) && !self::testEndpoint($e)) {
                throw new HttpError(422, 'Die Adresse beginnt mit https:// und enthält nur den Server, z. B. https://<konto>.r2.cloudflarestorage.com');
            }
            $c['endpoint'] = $e;
        }
        if (array_key_exists('bucket', $in)) {
            $b = trim((string) $in['bucket']);
            if ($b !== '' && !preg_match('/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/', $b)) {
                throw new HttpError(422, 'Der Bucket-Name besteht aus Kleinbuchstaben, Ziffern, Punkt und Bindestrich.');
            }
            $c['bucket'] = $b;
        }
        if (array_key_exists('region', $in)) {
            $c['region'] = preg_match('/^[a-z0-9-]{2,30}$/', (string) $in['region']) ? (string) $in['region'] : 'auto';
        }
        if (array_key_exists('prefix', $in)) {
            $c['prefix'] = trim((string) preg_replace('#[^A-Za-z0-9._/-]#', '', (string) $in['prefix']), '/');
        }
        if (array_key_exists('access_key', $in)) {
            $c['access_key'] = Util::str($in['access_key'], 200) ?? '';
        }
        if (array_key_exists('secret', $in) && is_string($in['secret']) && trim($in['secret']) !== '') {
            Settings::setSecret('backup_s3_secret', trim($in['secret']));
        }
        if (array_key_exists('on', $in)) {
            $c['on'] = (bool) $in['on'];
        }
        if (!empty($in['forget'])) {
            Settings::setSecret('backup_s3_secret', null);
            $c['on'] = false;
        }
        Settings::set('backup_s3', $c);
        return self::status();
    }

    /** Kleine Testdatei hochladen – zeigt sofort, ob Adresse, Bucket und Schlüssel stimmen. */
    public static function test(): array
    {
        $r = self::put('verbindungstest.txt', 'Perfume Cloud Team-App: Verbindungstest ' . date('c') . "\n", 'text/plain; charset=utf-8');
        Settings::set('backup_s3_last', $r + ['at' => Util::now(), 'name' => 'verbindungstest.txt']);
        return $r + ['s3' => self::status()];
    }

    /** Eine Sicherung hochladen. */
    public static function upload(string $name): array
    {
        $raw = (string) file_get_contents(Backup::path($name));
        $r = self::put($name, $raw, 'application/octet-stream');
        Settings::set('backup_s3_last', $r + ['at' => Util::now(), 'name' => $name, 'size' => strlen($raw)]);
        return $r;
    }

    /** @return array{ok:bool, message:string} */
    public static function put(string $name, string $body, string $type): array
    {
        $c = self::config();
        $secret = Settings::getSecret('backup_s3_secret');
        if (!self::configured() || $secret === null) {
            return ['ok' => false, 'message' => 'Der Speicher ist noch nicht vollständig eingerichtet.'];
        }
        $key = ($c['prefix'] !== '' ? $c['prefix'] . '/' : '') . $name;
        $path = '/' . rawurlencode($c['bucket']) . '/' . implode('/', array_map('rawurlencode', explode('/', $key)));
        $host = (string) parse_url($c['endpoint'], PHP_URL_HOST) . (parse_url($c['endpoint'], PHP_URL_PORT) ? ':' . parse_url($c['endpoint'], PHP_URL_PORT) : '');
        $hash = hash('sha256', $body);
        $headers = ['content-type' => $type, 'host' => $host, 'x-amz-content-sha256' => $hash, 'x-amz-date' => gmdate('Ymd\THis\Z')];
        $headers['authorization'] = self::authorization('PUT', $path, '', $headers, $hash, $c['region'], $c['access_key'], $secret);
        unset($headers['host']);

        $ch = curl_init($c['endpoint'] . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'PUT',
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_HTTPHEADER => array_map(static fn ($k, $v) => "$k: $v", array_keys($headers), $headers),
        ]);
        $res = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false) {
            return ['ok' => false, 'message' => 'Speicher nicht erreichbar: ' . $err];
        }
        if ($status >= 200 && $status < 300) {
            return ['ok' => true, 'message' => "Hochgeladen nach {$c['bucket']}/$key"];
        }
        preg_match('#<Code>([^<]+)</Code>#', (string) $res, $code);
        $code = $code[1] ?? '';
        return ['ok' => false, 'message' => match ($code) {
            'SignatureDoesNotMatch' => 'Der geheime Schlüssel passt nicht zur Zugriffsschlüssel-ID.',
            'InvalidAccessKeyId' => 'Diese Zugriffsschlüssel-ID kennt der Speicher nicht.',
            'NoSuchBucket' => "Den Bucket „{$c['bucket']}“ gibt es dort nicht.",
            'AccessDenied' => 'Der Schlüssel darf in diesen Bucket nicht schreiben.',
            default => "Hochladen fehlgeschlagen ($status" . ($code !== '' ? ", $code" : '') . ')',
        }];
    }

    /**
     * Authorization-Kopfzeile nach AWS Signature Version 4.
     * @param array<string,string> $headers alle zu signierenden Kopfzeilen (kleingeschrieben), mit host und x-amz-date
     */
    public static function authorization(string $method, string $path, string $query, array $headers, string $payloadHash, string $region, string $accessKey, string $secret): string
    {
        ksort($headers);
        $canonicalHeaders = '';
        foreach ($headers as $k => $v) {
            $canonicalHeaders .= strtolower($k) . ':' . trim((string) preg_replace('/\s+/', ' ', $v)) . "\n";
        }
        $signed = implode(';', array_map('strtolower', array_keys($headers)));
        $canonical = "$method\n$path\n$query\n$canonicalHeaders\n$signed\n$payloadHash";
        $amzDate = $headers['x-amz-date'];
        $day = substr($amzDate, 0, 8);
        $scope = "$day/$region/s3/aws4_request";
        $toSign = "AWS4-HMAC-SHA256\n$amzDate\n$scope\n" . hash('sha256', $canonical);
        $k = hash_hmac('sha256', $day, 'AWS4' . $secret, true);
        $k = hash_hmac('sha256', $region, $k, true);
        $k = hash_hmac('sha256', 's3', $k, true);
        $k = hash_hmac('sha256', 'aws4_request', $k, true);
        return "AWS4-HMAC-SHA256 Credential=$accessKey/$scope, SignedHeaders=$signed, Signature=" . hash_hmac('sha256', $toSign, $k);
    }

    /** Für Tests: http://127.0.0.1:<port> erlaubt, wenn PC_S3_TEST=1. */
    private static function testEndpoint(string $e): bool
    {
        return getenv('PC_S3_TEST') === '1' && (bool) preg_match('#^http://127\.0\.0\.1:\d+$#', $e);
    }
}
