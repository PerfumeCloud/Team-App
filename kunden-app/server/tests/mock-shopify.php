<?php
declare(strict_types=1);

/*
 * Nachbau der Shopify-Schnittstellen für Tests und Vorschau (php -S 127.0.0.1:PORT mock-shopify.php):
 *   Admin API (Token + GraphQL), Discovery, Anmeldung über die Customer Account API, Kunden-GraphQL.
 * Zustand liegt als JSON in MOCK_STATE. Steuerung: GET/POST /__mock/state
 */

$stateFile = getenv('MOCK_STATE') ?: sys_get_temp_dir() . '/club-mock-state.json';
$base = 'http://' . ($_SERVER['HTTP_HOST'] ?? '127.0.0.1');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

function load(string $f): array
{
    $s = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    return is_array($s) ? $s : [];
}
function save(string $f, array $s): void
{
    file_put_contents($f, json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
}
function out(mixed $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
function b64u(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

$state = load($stateFile) + [
    'scope' => 'read_orders,write_customers,read_customers,write_discounts,read_discounts',
    'adminClient' => ['id' => 'admin-client', 'secret' => 'admin-secret'],
    'caClient' => ['id' => 'ca-client', 'secret' => 'ca-secret'],
    'customers' => [],
    'orders' => [],
    'discounts' => [],
    'metafields' => [],
    'segments' => [],
    'nextId' => 1000,
    'login' => ['customer' => null, 'deny' => false],
    'codes' => [],
    'tokens' => [],
    'calls' => [],
    'failDiscount' => false,
    'pushes' => [],
    'pushStatus' => [],
];

// ---------- Steuerung für Tests ----------
if ($path === '/__mock/state') {
    if ($method === 'POST') {
        $in = json_decode((string) file_get_contents('php://input'), true) ?: [];
        $state = !empty($in['__replace']) ? array_diff_key($in, ['__replace' => 1]) + $state : array_merge($state, $in);
        save($stateFile, $state);
    }
    out($state);
    return true;
}

// ---------- Push-Dienst (wie Apple/Google/Mozilla): nimmt verschlüsselte Nachrichten an ----------
if (preg_match('#^/push/([\w-]+)$#', $path, $pm) && $method === 'POST') {
    $status = (int) ($state['pushStatus'][$pm[1]] ?? 201);
    $state['pushes'][] = [
        'device' => $pm[1],
        'authorization' => $_SERVER['HTTP_AUTHORIZATION'] ?? '',
        'encoding' => $_SERVER['HTTP_CONTENT_ENCODING'] ?? '',
        'ttl' => $_SERVER['HTTP_TTL'] ?? '',
        'body' => base64_encode((string) file_get_contents('php://input')),
        'status' => $status,
    ];
    save($stateFile, $state);
    if ($status >= 300) {
        out(['reason' => $status === 403 ? 'BadJwtToken' : 'Gone'], $status);
    } else {
        http_response_code($status);
    }
    return true;
}

// ---------- Admin API ----------
if ($path === '/admin/oauth/access_token' && $method === 'POST') {
    parse_str((string) file_get_contents('php://input'), $form);
    if (($form['client_id'] ?? '') !== $state['adminClient']['id'] || ($form['client_secret'] ?? '') !== $state['adminClient']['secret']) {
        out(['error' => 'invalid_client', 'error_description' => 'Client-ID oder Secret falsch'], 401);
        return true;
    }
    out(['access_token' => 'shpat_mock', 'scope' => $state['scope'], 'expires_in' => 86399]);
    return true;
}

if (preg_match('#^/admin/api/[0-9-]+/graphql\.json$#', $path)) {
    if (($_SERVER['HTTP_X_SHOPIFY_ACCESS_TOKEN'] ?? '') !== 'shpat_mock') {
        out(['errors' => 'Invalid API key or access token'], 401);
        return true;
    }
    $req = json_decode((string) file_get_contents('php://input'), true) ?: [];
    $q = (string) ($req['query'] ?? '');
    $v = (array) ($req['variables'] ?? []);
    preg_match('/^\s*(query|mutation)\s+(\w+)/', $q, $m);
    $op = $m[2] ?? (str_contains($q, 'shop {') ? 'Shop' : 'Unknown');
    $state['calls'][] = $op;

    $ordersOf = static function (string $cid) use ($state): array {
        $list = array_values(array_filter($state['orders'], static fn ($o) => ($o['customer']['id'] ?? '') === $cid));
        usort($list, static fn ($a, $b) => strcmp($b['processedAt'], $a['processedAt']));
        return $list;
    };

    switch ($op) {
        case 'Shop':
            $data = ['shop' => ['name' => 'Perfume Cloud (Test)', 'myshopifyDomain' => 'ks8yin-mg.myshopify.com', 'primaryDomain' => ['url' => 'https://www.perfumecloud.de']]];
            break;
        case 'ClubOrders':
        case 'ClubMemberOrders':
            $c = $state['customers'][$v['id']] ?? null;
            $data = ['customer' => $c ? ['orders' => ['nodes' => $ordersOf($v['id'])]] : null];
            break;
        case 'ClubSync':
            preg_match("/updated_at:>='([^']+)'/", (string) $v['q'], $mm);
            $since = $mm[1] ?? '1970-01-01T00:00:00Z';
            $list = array_values(array_filter($state['orders'], static fn ($o) => $o['updatedAt'] >= $since));
            usort($list, static fn ($a, $b) => strcmp($a['updatedAt'], $b['updatedAt']));
            $data = ['orders' => ['pageInfo' => ['hasNextPage' => false, 'endCursor' => null], 'nodes' => $list]];
            break;
        case 'ClubFind':
            preg_match('/email:"([^"]+)"/', (string) $v['q'], $mm);
            $found = null;
            foreach ($state['customers'] as $c) {
                if (strcasecmp($c['email'], $mm[1] ?? '') === 0) {
                    $found = ['id' => $c['id'], 'firstName' => $c['firstName'] ?? null, 'lastName' => $c['lastName'] ?? null, 'defaultEmailAddress' => ['emailAddress' => $c['email']]];
                }
            }
            $data = ['customers' => ['nodes' => $found ? [$found] : []]];
            break;
        case 'ClubCreate':
            $id = 'gid://shopify/Customer/' . (++$state['nextId']);
            $state['customers'][$id] = ['id' => $id, 'email' => $v['input']['email'], 'firstName' => null, 'lastName' => null, 'tags' => []];
            $data = ['customerCreate' => ['customer' => ['id' => $id, 'firstName' => null, 'lastName' => null], 'userErrors' => []]];
            break;
        case 'ClubTag':
        case 'ClubUntag':
            $tags = $state['customers'][$v['id']]['tags'] ?? [];
            $tags = $op === 'ClubTag' ? array_values(array_unique(array_merge($tags, $v['tags']))) : array_values(array_diff($tags, $v['tags']));
            $state['customers'][$v['id']]['tags'] = $tags;
            $data = [$op === 'ClubTag' ? 'tagsAdd' : 'tagsRemove' => ['userErrors' => []]];
            break;
        case 'ClubMeta':
            foreach ($v['m'] as $mf) {
                $state['metafields'][$mf['ownerId'] . '|' . $mf['namespace'] . '.' . $mf['key']] = $mf['value'];
            }
            $data = ['metafieldsSet' => ['metafields' => [], 'userErrors' => []]];
            break;
        case 'ClubMetaDelete':
            foreach ($v['m'] as $mf) {
                unset($state['metafields'][$mf['ownerId'] . '|' . $mf['namespace'] . '.' . $mf['key']]);
            }
            $data = ['metafieldsDelete' => ['userErrors' => []]];
            break;
        case 'ClubCustomer':
            $c = $state['customers'][$v['id']] ?? null;
            $data = ['customer' => $c ? [
                'id' => $c['id'],
                'tags' => $c['tags'] ?? [],
                'numberOfOrders' => (string) count($ordersOf($c['id'])),
                'defaultEmailAddress' => ['marketingState' => $c['marketing'] ?? 'NOT_SUBSCRIBED'],
            ] : null];
            break;
        case 'ClubNewsletter':
            $data = ['nodes' => array_map(static fn ($id) => isset($state['customers'][$id])
                ? ['id' => $id, 'defaultEmailAddress' => ['marketingState' => $state['customers'][$id]['marketing'] ?? 'NOT_SUBSCRIBED']]
                : null, $v['ids'])];
            break;
        case 'ClubTrack':
            $byId = array_column($state['orders'], null, 'id');
            $data = ['nodes' => array_map(static fn ($id) => $byId[$id] ?? null, $v['ids'])];
            break;
        case 'ClubWaitlist':
            preg_match('/tag:"([^"]+)"/', (string) $v['q'], $mm);
            $list = array_values(array_filter($state['customers'], static fn ($c) => in_array($mm[1] ?? '', $c['tags'] ?? [], true)));
            $data = ['customers' => ['pageInfo' => ['hasNextPage' => false, 'endCursor' => null], 'nodes' => array_map(static fn ($c) => [
                'id' => $c['id'], 'firstName' => $c['firstName'] ?? null, 'defaultEmailAddress' => ['emailAddress' => $c['email']],
            ], $list)]];
            break;
        case 'ClubShopId':
            $data = ['shop' => ['id' => 'gid://shopify/Shop/1']];
            break;
        case 'ClubShopMeta':
            foreach ($v['m'] as $mf) {
                $state['metafields'][$mf['ownerId'] . '|' . $mf['namespace'] . '.' . $mf['key']] = $mf['value'];
            }
            $data = ['metafieldsSet' => ['metafields' => [], 'userErrors' => []]];
            break;
        case 'ClubSegments':
            $data = ['segments' => ['nodes' => array_values($state['segments'] ?? [])]];
            break;
        case 'ClubSegmentCreate':
            $id = 'gid://shopify/Segment/' . (++$state['nextId']);
            $state['segments'][$id] = ['id' => $id, 'name' => $v['name'], 'query' => $v['query']];
            $data = ['segmentCreate' => ['segment' => ['id' => $id], 'userErrors' => []]];
            break;
        case 'ClubSegmentUpdate':
            $state['segments'][$v['id']]['query'] = $v['query'];
            $data = ['segmentUpdate' => ['segment' => ['id' => $v['id']], 'userErrors' => []]];
            break;
        case 'ClubCode':
            $in = $v['input'];
            if ($state['failDiscount']) {
                $data = ['discountCodeBasicCreate' => ['codeDiscountNode' => null, 'userErrors' => [['field' => ['code'], 'message' => 'Simulierter Fehler', 'code' => 'INVALID']]]];
                break;
            }
            $id = 'gid://shopify/DiscountCodeNode/' . (++$state['nextId']);
            $state['discounts'][$id] = ['code' => $in['code'], 'usage' => 0, 'input' => $in];
            $data = ['discountCodeBasicCreate' => ['codeDiscountNode' => ['id' => $id], 'userErrors' => []]];
            break;
        case 'ClubCodeCheck':
            $d = $state['discounts'][$v['id']] ?? null;
            $data = ['codeDiscountNode' => $d ? ['id' => $v['id'], 'codeDiscount' => ['asyncUsageCount' => $d['usage']]] : null];
            break;
        case 'ClubCodeDelete':
            unset($state['discounts'][$v['id']]);
            $data = ['discountCodeDelete' => ['deletedCodeDiscountId' => $v['id'], 'userErrors' => []]];
            break;
        default:
            save($stateFile, $state);
            out(['errors' => [['message' => "Mock kennt $op nicht"]]]);
            return true;
    }
    save($stateFile, $state);
    out(['data' => $data]);
    return true;
}

// ---------- Customer Account API (Anmeldung) ----------
if ($path === '/.well-known/openid-configuration') {
    out([
        'issuer' => $base,
        'authorization_endpoint' => "$base/authentication/oauth/authorize",
        'token_endpoint' => "$base/authentication/oauth/token",
        'end_session_endpoint' => "$base/authentication/logout",
    ]);
    return true;
}
if ($path === '/.well-known/customer-account-api') {
    out(['graphql_api' => "$base/account/customer/api/2026-10/graphql"]);
    return true;
}
if ($path === '/authentication/oauth/authorize') {
    $redirect = (string) ($_GET['redirect_uri'] ?? '');
    $sep = str_contains($redirect, '?') ? '&' : '?';
    if (($_GET['client_id'] ?? '') !== $state['caClient']['id']) {
        out(['error' => 'invalid_client'], 400);
        return true;
    }
    $customer = $state['login']['customer'] ?? null;
    if (!empty($state['login']['deny']) || !$customer) {
        $err = ($_GET['prompt'] ?? '') === 'none' ? 'login_required' : 'access_denied';
        header('Location: ' . $redirect . $sep . http_build_query(['error' => $err, 'state' => $_GET['state'] ?? '']));
        http_response_code(302);
        return true;
    }
    $code = bin2hex(random_bytes(8));
    $state['codes'][$code] = [
        'customer' => $customer,
        'nonce' => $_GET['nonce'] ?? null,
        'challenge' => $_GET['code_challenge'] ?? null,
        'redirect' => $redirect,
    ];
    save($stateFile, $state);
    header('Location: ' . $redirect . $sep . http_build_query(['code' => $code, 'state' => $_GET['state'] ?? '']));
    http_response_code(302);
    return true;
}
if ($path === '/authentication/oauth/token' && $method === 'POST') {
    parse_str((string) file_get_contents('php://input'), $form);
    $c = $state['codes'][$form['code'] ?? ''] ?? null;
    if (!$c || ($form['redirect_uri'] ?? '') !== $c['redirect']) {
        out(['error' => 'invalid_grant'], 400);
        return true;
    }
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($auth !== '') {
        if ($auth !== 'Basic ' . base64_encode($state['caClient']['id'] . ':' . $state['caClient']['secret'])) {
            out(['error' => 'invalid_client'], 401);
            return true;
        }
    } else {
        $verifier = (string) ($form['code_verifier'] ?? '');
        if (!$c['challenge'] || b64u(hash('sha256', $verifier, true)) !== $c['challenge']) {
            out(['error' => 'invalid_grant', 'error_description' => 'PKCE'], 400);
            return true;
        }
    }
    unset($state['codes'][$form['code']]);
    $token = 'cat_' . bin2hex(random_bytes(8));
    $state['tokens'][$token] = $c['customer'];
    save($stateFile, $state);
    $idToken = b64u('{"alg":"none"}') . '.' . b64u(json_encode(['sub' => $c['customer'], 'nonce' => $c['nonce']])) . '.sig';
    out(['access_token' => $token, 'id_token' => $idToken, 'refresh_token' => 'r_' . $token, 'expires_in' => 3600]);
    return true;
}
if (preg_match('#^/account/customer/api/[0-9-]+/graphql$#', $path)) {
    $cid = $state['tokens'][$_SERVER['HTTP_AUTHORIZATION'] ?? ''] ?? null;
    $c = $cid ? ($state['customers'][$cid] ?? null) : null;
    if (!$c) {
        out(['errors' => [['message' => 'Unauthorized']]], 401);
        return true;
    }
    out(['data' => ['customer' => ['id' => $c['id'], 'firstName' => $c['firstName'] ?? null, 'lastName' => $c['lastName'] ?? null, 'emailAddress' => ['emailAddress' => $c['email']]]]]);
    return true;
}
if ($path === '/authentication/logout') {
    header('Location: ' . ($_GET['post_logout_redirect_uri'] ?? '/'));
    http_response_code(302);
    return true;
}

out(['error' => 'not found: ' . $path], 404);
return true;
