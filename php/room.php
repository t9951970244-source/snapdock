<?php
/**
 * SnapDock — комната на обычном хостинге.
 *
 * Работает там, где есть только PHP: ни постоянного соединения, ни отдельного
 * процесса не требуется. Участники обмениваются короткими сообщениями обычными
 * запросами, а видео, звук и файлы после этого идут между компьютерами напрямую.
 *
 * Ничего не хранится дольше нескольких минут: старые комнаты удаляются сами.
 *
 * Положить рядом с index.html в папку сайта. Больше ничего делать не нужно.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

const KEEP_MSGS   = 300;   // сколько последних сообщений держим
const PEER_TTL    = 20;    // через сколько секунд молчащий участник считается ушедшим
const ROOM_TTL    = 900;   // через сколько удаляем заброшенную комнату
const POLL_MAX    = 25;    // сколько секунд держим запрос, ожидая новое
const POLL_STEP   = 250000;// пауза между проверками, микросекунды

$dir = __DIR__ . '/snapdock-data';
if (!is_dir($dir)) { @mkdir($dir, 0775, true); }

/** Имя файла комнаты. Название приводим к безопасному виду. */
function room_file(string $dir, string $room): string {
    return $dir . '/r_' . substr(hash('sha256', $room), 0, 32) . '.json';
}

/** Чтение и запись под замком: два участника не затрут друг друга. */
function with_room(string $file, callable $fn) {
    $fh = fopen($file, 'c+');
    if (!$fh) { return null; }
    flock($fh, LOCK_EX);
    $raw  = stream_get_contents($fh);
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data)) { $data = ['seq' => 0, 'msgs' => [], 'peers' => []]; }

    // убираем тех, кто давно молчит
    $now = time();
    foreach ($data['peers'] as $id => $p) {
        if ($now - ($p['seen'] ?? 0) > PEER_TTL) { unset($data['peers'][$id]); }
    }

    $result = $fn($data);

    if (count($data['msgs']) > KEEP_MSGS) {
        $data['msgs'] = array_slice($data['msgs'], -KEEP_MSGS);
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data, JSON_UNESCAPED_UNICODE));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $result;
}

/** Уборка заброшенных комнат — раз в сотню запросов, чтобы не тормозить. */
function sweep(string $dir) {
    if (random_int(1, 100) !== 1) { return; }
    foreach (glob($dir . '/r_*.json') as $f) {
        if (time() - filemtime($f) > ROOM_TTL) { @unlink($f); }
    }
}

$action = $_GET['a']    ?? '';
$room   = substr((string)($_GET['room'] ?? ''), 0, 64);
$id     = substr((string)($_GET['id']   ?? ''), 0, 32);
if ($room === '') { echo json_encode(['error' => 'no room']); exit; }

$file = room_file($dir, $room);
sweep($dir);

/* ---------------- вход в комнату ---------------- */
if ($action === 'join') {
    $name = substr((string)($_GET['name'] ?? 'Гость'), 0, 40);
    // Постоянный знак участника: при повторном входе старая запись заменяется,
    // а не добавляется рядом. Иначе после переподключения появлялись двойники.
    $uid  = preg_replace('/[^a-z0-9]/i', '', (string)($_GET['uid'] ?? ''));
    $id   = $uid !== '' ? substr($uid, 0, 24) : bin2hex(random_bytes(6));
    $out  = with_room($file, function (&$d) use ($id, $name) {
        $fresh = !isset($d['peers'][$id]);
        $d['peers'][$id] = ['name' => $name, 'seen' => time()];
        if ($fresh) {
            $d['seq']++;
            $d['msgs'][] = ['n' => $d['seq'], 't' => 'joined', 'from' => $id, 'name' => $name];
        }
        return ['id' => $id, 'since' => $d['seq'], 'peers' => $d['peers']];
    });
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------- отправка ---------------- */
if ($action === 'send') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) { echo json_encode(['error' => 'bad body']); exit; }
    $out = with_room($file, function (&$d) use ($id, $body) {
        if (isset($d['peers'][$id])) { $d['peers'][$id]['seen'] = time(); }
        $d['seq']++;
        $body['n']    = $d['seq'];
        $body['from'] = $id;
        $body['name'] = $d['peers'][$id]['name'] ?? '';
        $d['msgs'][]  = $body;
        return ['n' => $d['seq']];
    });
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------- ожидание нового ---------------- */
if ($action === 'poll') {
    $since = (int)($_GET['since'] ?? 0);
    $until = microtime(true) + POLL_MAX;

    // Отмечаемся живыми сразу, чтобы нас не выкинули из списка во время ожидания
    with_room($file, function (&$d) use ($id) {
        if (isset($d['peers'][$id])) { $d['peers'][$id]['seen'] = time(); }
        return null;
    });

    while (true) {
        $out = with_room($file, function (&$d) use ($id, $since) {
            if (isset($d['peers'][$id])) { $d['peers'][$id]['seen'] = time(); }
            $mine = [];
            foreach ($d['msgs'] as $m) {
                if ($m['n'] <= $since) { continue; }
                if ($m['from'] === $id) { continue; }                 // своё назад не шлём
                if (isset($m['to']) && $m['to'] !== $id) { continue; } // личное — только адресату
                $mine[] = $m;
            }
            return ['msgs' => $mine, 'seq' => $d['seq'], 'peers' => $d['peers']];
        });

        if (!empty($out['msgs']) || microtime(true) >= $until) {
            echo json_encode($out, JSON_UNESCAPED_UNICODE);
            exit;
        }
        usleep(POLL_STEP);
    }
}

/* ---------------- выход ---------------- */
if ($action === 'leave') {
    with_room($file, function (&$d) use ($id) {
        unset($d['peers'][$id]);
        $d['seq']++;
        $d['msgs'][] = ['n' => $d['seq'], 't' => 'left', 'from' => $id];
        return null;
    });
    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'unknown action']);
