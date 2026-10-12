"""Mini-IMAP-Server für Tests (unverschlüsselt, nur lesend). Aufruf: python3 fake-imap.py PORT"""
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
        parts = line.decode().strip().split(' ', 2)
        tag, cmd = parts[0], parts[1].upper()
        arg = parts[2] if len(parts) > 2 else ''
        if cmd == 'LOGIN':
            if '"secret"' in arg:
                send(f'{tag} OK LOGIN completed\r\n')
            else:
                send(f'{tag} NO [AUTHENTICATIONFAILED] Authentication failed\r\n')
        elif cmd == 'LIST':
            send('* LIST (\\HasNoChildren) "." "INBOX"\r\n')
            send('* LIST (\\HasNoChildren \\Sent) "." "Sent"\r\n')
            send('* LIST (\\HasNoChildren \\Trash) "." "Trash"\r\n')
            send(f'{tag} OK LIST completed\r\n')
        elif cmd == 'EXAMINE':
            folder = SENT if 'Sent' in arg else INBOX
            send(f'* {len(folder)} EXISTS\r\n* OK [UIDVALIDITY 777] UIDs valid\r\n{tag} OK [READ-ONLY] EXAMINE completed\r\n')
        elif cmd == 'UID':
            sub = arg.split(' ', 1)
            if sub[0].upper() == 'SEARCH':
                send('* SEARCH ' + ' '.join(str(m['uid']) for m in folder) + '\r\n')
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


def main():
    port = int(sys.argv[1])
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', port))
    s.listen(5)
    print('ready', flush=True)
    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()


if __name__ == '__main__':
    main()
