"""Mini-IMAP-Server (unverschlüsselt, nur lesend, mit IDLE) und Mini-SMTP-Server für Tests.
Aufruf: python3 fake-imap.py IMAP-PORT [SMTP-PORT]
Angenommene Mails stehen als Zeile „MAIL {json}“ auf stdout.
Neue Mail zustellen: Zeile „ADD {"from": …, "subject": …, "body": …}“ auf stdin – wer gerade IDLE wartet,
bekommt sofort „* n EXISTS“. „NOIDLE“ / „IDLE“ auf stdin schaltet die IDLE-Fähigkeit aus bzw. an."""
import base64
import json
import shlex
import socket
import sys
import threading
import time
from email.utils import format_datetime
from datetime import datetime, timedelta, timezone

NOW = datetime.now(timezone.utc)


def imap_date(dt):
    return dt.strftime('%d-%b-%Y %H:%M:%S +0000')


def msg(uid, flags, age_h, headers, body):
    dt = NOW - timedelta(hours=age_h)
    hdr = {'Date': format_datetime(dt), **headers}
    return {
        'uid': uid,
        'flags': flags,
        'internal': imap_date(dt),
        'headers': ''.join(f'{k}: {v}\r\n' for k, v in hdr.items()) + '\r\n',
        'body': body,
    }


INBOX = [
    # 1: Kundin fragt nach Bestellung, ungelesen -> wichtig (Kundenanliegen, Ungelesen)
    msg(101, [], 2, {
        'From': '=?UTF-8?B?SsO8cmdlbiBNw7xsbGVy?= <juergen@example.de>',
        'Subject': '=?UTF-8?Q?Wo_bleibt_meine_Bestellung_=231042=3F?=',
        'Message-ID': '<a1@example.de>',
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Transfer-Encoding': 'quoted-printable',
    }, 'Hallo liebes Team,\r\nich warte seit einer Woche auf mein Paket. K=C3=B6nnt ihr nachsehen?\r\n\r\nAm 01.10.2026 schrieb Perfume Cloud:\r\n> Danke f=C3=BCr deine Bestellung\r\n'),
    # 2: Newsletter -> ignoriert
    msg(102, [], 1, {
        'From': 'Newsletter <news@brand.com>',
        'Subject': 'Unsere Herbst-Angebote',
        'List-Unsubscribe': '<mailto:unsub@brand.com>',
        'Message-ID': '<n1@brand.com>',
    }, 'Angebote...'),
    # 3: gelesen, beantwortet -> nicht wichtig
    msg(103, ['\\Seen', '\\Answered'], 5, {
        'From': 'Anna <anna@example.com>',
        'Subject': 'Kooperation?',
        'Message-ID': '<a3@example.com>',
    }, 'Hi, hättet ihr Lust auf eine Kooperation?'),
    # 4: gelesen, Antwort liegt im Gesendet-Ordner -> beantwortet
    msg(104, ['\\Seen'], 30, {
        'From': 'Ben <ben@example.com>',
        'Subject': 'Retoure',
        'Message-ID': '<a4@example.com>',
    }, 'Ich möchte den Duft zurückschicken.'),
    # 5: gelesen, markiert, multipart/alternative mit base64 -> wichtig (Markiert)
    msg(105, ['\\Seen', '\\Flagged'], 3, {
        'From': '"Carla, Studio" <carla@studio.de>',
        'Subject': 'Fotoshooting nächste Woche',
        'Message-ID': '<a5@studio.de>',
        'Content-Type': 'multipart/alternative; boundary="XYZ"',
    }, '--XYZ\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nSGFsbG8sIHBhc3N0IGV1Y2ggRGllbnN0YWcgdW0gMTAgVWhyPw==\r\n--XYZ\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hallo</p>\r\n--XYZ--\r\n'),
    # 6: Shopify-Systemmail -> ignoriert
    msg(106, [], 1, {
        'From': 'Shopify <mailer@shopify.com>',
        'Subject': '[Perfume Cloud] Bestellung #1043 aufgegeben',
        'Message-ID': '<s1@shopify.com>',
    }, 'Neue Bestellung'),
    # 7: gelesen, alt (30 h), unbeantwortet, kein Stichwort -> wichtig (über 24 Std.)
    msg(107, ['\\Seen'], 30, {
        'From': 'Dora <dora@example.org>',
        'Subject': 'Kurze Rückmeldung',
        'Message-ID': '<a7@example.org>',
        'Content-Type': 'text/html; charset=iso-8859-1',
    }, '<html><head><style>p{}</style></head><body><p>Sch\xf6ne Grü\xdfe</p></body></html>'),
]

SENT = [
    msg(201, ['\\Seen'], 20, {
        'From': 'support@perfumecloud.de',
        'Subject': 'Re: Retoure',
        'In-Reply-To': '<a4@example.com>',
        'Message-ID': '<r1@perfumecloud.de>',
    }, 'Klar!'),
]


# Ordner wie bei netcup/Dovecot (Trennzeichen „.“); Unterordner z. B. „INBOX.Lieferanten“
FOLDERS = {'INBOX': INBOX, 'Sent': SENT, 'Trash': [], 'Kunden': [], 'Kunden.Stammkunden': [msg(301, ['\\Seen'], 200, {
    'From': 'Eva <eva@example.de>',
    'To': 'info@perfumecloud.de',
    'Subject': 'Danke für den tollen Duft',
    'Message-ID': '<e1@example.de>',
}, 'Liebe Grüße von Eva')]}
SPECIAL = {'Sent': '\\Sent', 'Trash': '\\Trash'}


def next_uid(folder):
    return max([m['uid'] for m in folder] or [0]) + 1


# Verbindungen im IDLE-Zustand: Liste von send-Funktionen
IDLERS = []
LOCK = threading.Lock()
STATE = {'idle': True}


def add_mail(data):
    """Neue Mail in den Posteingang legen und alle IDLE-Verbindungen benachrichtigen."""
    with LOCK:
        uid = max(m['uid'] for m in INBOX) + 1
        headers = {
            'From': data.get('from', 'Neu <neu@example.de>'),
            'Subject': data.get('subject', 'Neue Mail'),
            'Message-ID': f'<live{uid}@example.de>',
            'Content-Type': 'text/plain; charset=utf-8',
        }
        INBOX.append(msg(uid, data.get('flags', []), -((datetime.now(timezone.utc) - NOW).total_seconds() / 3600), headers, data.get('body', 'Hallo')))
        count = len(INBOX)
        for send in list(IDLERS):
            try:
                send(f'* {count} EXISTS\r\n* 1 RECENT\r\n')
            except OSError:
                pass
    return uid


# Passwörter, die der Test-Server annimmt (auch mit Umlauten/€ → kommt per IMAP-Literal)
PASSWORDS = {'secret', 'sécret€'}


def encode(s):
    return s.encode('latin-1') if any(ord(c) > 127 and ord(c) < 256 for c in s) and 'iso' in s.lower() else s.encode('utf-8')


def handle(conn):
    f = conn.makefile('rb')
    send = lambda b: conn.sendall(b if isinstance(b, bytes) else b.encode())
    send('* OK fake IMAP ready\r\n')
    folder = None
    while True:
        line = f.readline()
        if not line:
            break
        parts = line.decode('utf-8', 'replace').strip().split(' ', 2)
        tag, cmd = parts[0], parts[1].upper()
        arg = parts[2] if len(parts) > 2 else ''
        if cmd == 'LOGIN' and arg.endswith('}'):
            # LOGIN {n} → Benutzer als Literal, danach Passwort als Literal
            send('+ Ready for literal data\r\n')
            n = int(arg[1:-1])
            user = f.read(n)
            rest = f.readline().decode().strip()
            m = int(rest[1:-1])
            send('+ Ready for literal data\r\n')
            pw = f.read(m).decode('utf-8', 'replace')
            f.readline()
            if pw in PASSWORDS:
                send(f'{tag} OK LOGIN completed\r\n')
            else:
                send(f'{tag} NO [AUTHENTICATIONFAILED] Authentication failed\r\n')
        elif cmd == 'LOGIN':
            if any(f'"{p}"' in arg for p in PASSWORDS):
                send(f'{tag} OK LOGIN completed\r\n')
            else:
                send(f'{tag} NO [AUTHENTICATIONFAILED] Authentication failed\r\n')
        elif cmd == 'LIST':
            for name in list(FOLDERS):
                kids = any(n.startswith(name + '.') for n in FOLDERS)
                flags = ['\\HasChildren' if kids else '\\HasNoChildren'] + ([SPECIAL[name]] if name in SPECIAL else [])
                send(f'* LIST ({" ".join(flags)}) "." "{name}"\r\n')
            send(f'{tag} OK LIST completed\r\n')
        elif cmd == 'NAMESPACE':
            send(f'* NAMESPACE (("" ".")) NIL NIL\r\n{tag} OK NAMESPACE completed\r\n')
        elif cmd in ('CREATE', 'DELETE', 'RENAME', 'SUBSCRIBE', 'UNSUBSCRIBE'):
            names = shlex.split(arg)
            with LOCK:
                if cmd == 'CREATE':
                    if names[0] in FOLDERS:
                        send(f'{tag} NO [ALREADYEXISTS] Mailbox exists\r\n')
                        continue
                    FOLDERS[names[0]] = []
                elif cmd == 'DELETE':
                    if names[0] not in FOLDERS or names[0] == 'INBOX':
                        send(f'{tag} NO [NONEXISTENT] Mailbox does not exist\r\n')
                        continue
                    del FOLDERS[names[0]]
                elif cmd == 'RENAME':
                    FOLDERS[names[1]] = FOLDERS.pop(names[0])
            print('FOLDER ' + json.dumps({'cmd': cmd, 'names': names}), flush=True)
            send(f'{tag} OK {cmd} completed\r\n')
        elif cmd == 'CAPABILITY':
            send('* CAPABILITY IMAP4rev1 MOVE UIDPLUS' + (' IDLE' if STATE['idle'] else '') + f'\r\n{tag} OK CAPABILITY completed\r\n')
        elif cmd == 'NOOP':
            send(f'* {len(folder or INBOX)} EXISTS\r\n{tag} OK NOOP completed\r\n')
        elif cmd == 'IDLE':
            out = lambda b: send(b)
            with LOCK:
                IDLERS.append(out)
            send('+ idling\r\n')
            done = f.readline()
            with LOCK:
                IDLERS.remove(out)
            if not done:
                break
            if done.strip().upper() == b'DONE':
                send(f'{tag} OK IDLE terminated\r\n')
            else:
                send(f'{tag} BAD expected DONE\r\n')
        elif cmd in ('EXAMINE', 'SELECT'):
            name = shlex.split(arg)[0]
            if name not in FOLDERS:
                send(f'{tag} NO [NONEXISTENT] Mailbox does not exist\r\n')
                continue
            folder = FOLDERS[name]
            uidnext = next_uid(folder)
            mode = 'READ-ONLY' if cmd == 'EXAMINE' else 'READ-WRITE'
            send(f'* {len(folder)} EXISTS\r\n* OK [UIDVALIDITY 777] UIDs valid\r\n* OK [UIDNEXT {uidnext}] Predicted next UID\r\n{tag} OK [{mode}] {cmd} completed\r\n')
        elif cmd == 'APPEND':
            # APPEND "Sent" (\Seen) {n} → Mail als Literal
            n = int(arg[arg.rindex('{') + 1:arg.rindex('}')])
            send('+ Ready for literal data\r\n')
            data = f.read(n)
            f.readline()
            with LOCK:
                uid = next_uid(SENT)
                head, _, body = data.decode('utf-8', 'replace').partition('\r\n\r\n')
                SENT.append({'uid': uid, 'flags': ['\\Seen'], 'internal': imap_date(datetime.now(timezone.utc)), 'headers': head + '\r\n\r\n', 'body': body})
            print('APPENDED ' + json.dumps({'folder': arg.split(' ')[0].strip('"'), 'size': n}), flush=True)
            send(f'{tag} OK APPEND completed\r\n')
        elif cmd == 'UID':
            sub = arg.split(' ', 1)
            if sub[0].upper() == 'STORE':
                uidset, rest = sub[1].split(' ', 1)
                wanted = {int(u) for u in uidset.split(',')}
                flags = rest[rest.index('(') + 1:rest.index(')')].split()
                for m in folder:
                    if m['uid'] in wanted:
                        for fl in flags:
                            if fl not in m['flags']:
                                m['flags'].append(fl)
                print('STORED ' + json.dumps({'uids': sorted(wanted), 'flags': flags}), flush=True)
                send(f'{tag} OK STORE completed\r\n')
            elif sub[0].upper() == 'MOVE':
                uidset, dest = sub[1].split(' ', 1)
                dest = shlex.split(dest)[0]
                wanted = {int(u) for u in uidset.split(',')}
                with LOCK:
                    target = FOLDERS[dest]
                    moving = [m for m in folder if m['uid'] in wanted]
                    for m in moving:
                        folder.remove(m)
                        target.append({**m, 'uid': next_uid(target)})
                print('MOVED ' + json.dumps({'uids': sorted(wanted), 'to': dest}), flush=True)
                send(f'{tag} OK MOVE completed\r\n')
            elif sub[0].upper() == 'SEARCH':
                uids = [m['uid'] for m in folder]
                crit = sub[1] if len(sub) > 1 else ''
                if crit.upper().startswith('HEADER MESSAGE-ID '):
                    want = crit.split(' ', 2)[2].strip('"').lower()
                    uids = [m['uid'] for m in folder if f'message-id: {want}' in m['headers'].lower()]
                elif crit.upper().startswith('UID '):
                    # „UID n:*“ – wie echte Server: mindestens die höchste UID
                    low = int(crit.split(' ', 1)[1].split(':')[0])
                    uids = [u for u in uids if u >= low] or [max(uids)]
                send('* SEARCH ' + ' '.join(str(u) for u in uids) + '\r\n')
                send(f'{tag} OK SEARCH completed\r\n')
            elif sub[0].upper() == 'FETCH':
                uidset, items = sub[1].split(' ', 1)
                wanted = {int(u) for u in uidset.split(',')}
                for i, m in enumerate(folder, 1):
                    if m['uid'] not in wanted:
                        continue
                    out = f'* {i} FETCH (UID {m["uid"]} FLAGS ({" ".join(m["flags"])}) INTERNALDATE "{m["internal"]}"'.encode()
                    if 'HEADER.FIELDS' in items:
                        h = m['headers'].encode('utf-8')
                        fields = items[items.index('HEADER.FIELDS'):items.index(')') + 1]
                        out += f' BODY[{fields}] {{{len(h)}}}\r\n'.encode() + h
                    if 'BODY.PEEK[]' in items:
                        raw = m['headers'].encode('utf-8') + (m['body'].encode('latin-1') if 'iso-8859-1' in m['headers'] else m['body'].encode('utf-8'))
                        out += f' BODY[]<0> {{{len(raw)}}}\r\n'.encode() + raw
                    if 'BODY.PEEK[TEXT]' in items:
                        b = m['body'].encode('latin-1') if 'iso-8859-1' in m['headers'] else m['body'].encode('utf-8')
                        out += f' BODY[TEXT]<0> {{{len(b)}}}\r\n'.encode() + b
                    out += b')\r\n'
                    send(out)
                send(f'{tag} OK FETCH completed\r\n')
        elif cmd == 'LOGOUT':
            send(f'* BYE\r\n{tag} OK LOGOUT completed\r\n')
            break
        else:
            send(f'{tag} BAD unknown\r\n')
    conn.close()


def handle_smtp(conn):
    """Wie netcup: Anmeldung nötig, Absender muss das angemeldete Postfach sein."""
    f = conn.makefile('rb')
    send = lambda b: conn.sendall(b if isinstance(b, bytes) else b.encode())
    send('220 fake.smtp ESMTP\r\n')
    authed = None
    mail = None
    while True:
        line = f.readline()
        if not line:
            break
        cmd = line.decode('utf-8', 'replace').rstrip('\r\n')
        up = cmd.upper()
        if up.startswith('EHLO') or up.startswith('HELO'):
            send('250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n')
        elif up.startswith('AUTH PLAIN '):
            _, user, pw = base64.b64decode(cmd[11:]).split(b'\0')
            if pw.decode('utf-8', 'replace') in PASSWORDS:
                authed = user.decode()
                send('235 2.7.0 Authentication successful\r\n')
            else:
                send('535 5.7.8 Error: authentication failed\r\n')
        elif up == 'AUTH LOGIN':
            send('334 VXNlcm5hbWU6\r\n')
            user = base64.b64decode(f.readline().strip()).decode()
            send('334 UGFzc3dvcmQ6\r\n')
            pw = base64.b64decode(f.readline().strip()).decode('utf-8', 'replace')
            if pw in PASSWORDS:
                authed = user
                send('235 2.7.0 Authentication successful\r\n')
            else:
                send('535 5.7.8 Error: authentication failed\r\n')
        elif up.startswith('MAIL FROM:'):
            addr = cmd[10:].strip().strip('<>')
            if not authed:
                send('530 5.7.0 Authentication required\r\n')
            elif addr.lower() != authed.lower():
                send(f'553 5.7.1 <{addr}>: Sender address rejected: not owned by user {authed}\r\n')
            else:
                mail = {'from': addr, 'to': []}
                send('250 2.1.0 Ok\r\n')
        elif up.startswith('RCPT TO:') and mail is not None:
            mail['to'].append(cmd[8:].strip().strip('<>'))
            send('250 2.1.5 Ok\r\n')
        elif up == 'DATA' and mail is not None:
            send('354 End data with <CR><LF>.<CR><LF>\r\n')
            data = b''
            while True:
                l = f.readline()
                if not l or l in (b'.\r\n', b'.\n'):
                    break
                data += l
            mail['data'] = data.decode('utf-8', 'replace')
            print('MAIL ' + json.dumps(mail), flush=True)
            mail = None
            send('250 2.0.0 Ok: queued as 4FAKE1\r\n')
        elif up == 'QUIT':
            send('221 2.0.0 Bye\r\n')
            break
        else:
            send('502 5.5.2 Error: command not recognized\r\n')
    conn.close()


def serve(port, handler):
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', port))
    s.listen(5)
    while True:
        c, _ = s.accept()
        threading.Thread(target=handler, args=(c,), daemon=True).start()


def main():
    if len(sys.argv) > 2:
        threading.Thread(target=serve, args=(int(sys.argv[2]), handle_smtp), daemon=True).start()
    threading.Thread(target=serve, args=(int(sys.argv[1]), handle), daemon=True).start()
    time.sleep(0.2)
    print('ready', flush=True)
    for line in sys.stdin:
        line = line.strip()
        if line.startswith('ADD '):
            uid = add_mail(json.loads(line[4:]))
            print(f'ADDED {uid}', flush=True)
        elif line == 'NOIDLE':
            STATE['idle'] = False
            print('OK NOIDLE', flush=True)
        elif line == 'IDLE':
            STATE['idle'] = True
            print('OK IDLE', flush=True)
    while True:
        time.sleep(3600)


if __name__ == '__main__':
    main()
