"""Fixed synthetic calls to our mock service; never scan or try credentials."""
import argparse,ipaddress,os,socket
from urllib.parse import urlsplit
PRIVATE=[ipaddress.ip_network(s) for s in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')]
def guard(target,yes=False,loopback_only=False):
    if os.environ.get('LAB_MODE')!='1' or not yes:raise ValueError('LAB_MODE=1 and --yes are required')
    u=urlsplit(target)
    if u.scheme!='http' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):raise ValueError('Use an HTTP origin without credentials, path, query or fragment')
    addresses={ipaddress.ip_address(r[4][0]) for r in socket.getaddrinfo(u.hostname,u.port or 80,type=socket.SOCK_STREAM)}
    if not addresses or any(not(a.is_loopback or (not loopback_only and any(a.version==n.version and a in n for n in PRIVATE))) for a in addresses):raise ValueError('Target must resolve entirely to loopback or RFC1918 addresses we own')
    # Pin the validated address so a second DNS resolution cannot redirect traffic.
    address=str(sorted(addresses,key=str)[0]);host='['+address+']' if ':' in address else address
    return f'http://{host}:{u.port or 80}'
def main():
    p=argparse.ArgumentParser();p.add_argument('--target',default='http://127.0.0.1:8001');p.add_argument('--yes',action='store_true');a=p.parse_args();target=guard(a.target,a.yes);print('Owned mock target:',target)
    import httpx
    with httpx.Client(base_url=target,trust_env=False,follow_redirects=False,timeout=10) as c:
        for _ in range(5):c.post('/lab/login-failure').raise_for_status()
        for _ in range(3):c.post('/lab/unmatched-payout').raise_for_status()
        r=c.post('/lab/chain');r.raise_for_status();print(r.json())
if __name__=='__main__':main()
