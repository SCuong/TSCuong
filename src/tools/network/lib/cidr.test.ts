import { describe, expect, it } from 'vitest';
import {
  cidrContains,
  compressIPv6,
  expandIPv6,
  formatBig,
  formatIPv4,
  ipv4Class,
  ipv4Info,
  ipv4Type,
  ipv6Info,
  ipv6Type,
  maskToPrefix,
  parseIPv4,
  parseIPv4Cidr,
  parseIPv6,
  parseIPv6Cidr,
  prefixToMask,
  splitIPv4,
  toBinaryIPv4,
} from './cidr';

const v6 = (s: string) => parseIPv6(s).value;
const canon = (s: string) => compressIPv6(v6(s));

describe('parseIPv4', () => {
  it.each([
    ['0.0.0.0', 0],
    ['255.255.255.255', 0xffffffff],
    ['192.168.1.10', 0xc0a8010a],
    ['10.0.0.1', 0x0a000001],
    [' 8.8.8.8 ', 0x08080808],
  ])('parses %s', (text, value) => {
    expect(parseIPv4(text)).toBe(value);
  });

  it.each([
    ['', /Enter an IPv4/],
    ['1.2.3', /expected 4 numbers/],
    ['1.2.3.4.5', /found 5/],
    ['1.2.3.256', /256 is out of range/],
    ['1..3.4', /empty octet/],
    ['1.2.3.a', /not a number/],
    ['010.0.0.1', /leading zero/],
    ['1.2.3.-1', /not a number/],
    ['1.2.3.4 ', null],
  ])('rejects or accepts %j', (text, error) => {
    if (error) expect(() => parseIPv4(text)).toThrow(error);
    else expect(() => parseIPv4(text)).not.toThrow();
  });

  it('round-trips through formatIPv4', () => {
    for (const ip of ['0.0.0.0', '1.2.3.4', '172.31.255.254', '255.255.255.255']) {
      expect(formatIPv4(parseIPv4(ip))).toBe(ip);
    }
  });
});

describe('masks', () => {
  it.each([
    [0, '0.0.0.0'],
    [1, '128.0.0.0'],
    [8, '255.0.0.0'],
    [20, '255.255.240.0'],
    [24, '255.255.255.0'],
    [31, '255.255.255.254'],
    [32, '255.255.255.255'],
  ])('prefix /%i -> %s and back', (prefix, mask) => {
    expect(formatIPv4(prefixToMask(prefix))).toBe(mask);
    expect(maskToPrefix(parseIPv4(mask))).toBe(prefix);
  });

  it('rejects non-contiguous masks', () => {
    expect(() => maskToPrefix(parseIPv4('255.0.255.0'))).toThrow(/contiguous/);
    expect(() => maskToPrefix(parseIPv4('0.255.255.255'))).toThrow(/contiguous/);
  });

  it('formats binary', () => {
    expect(toBinaryIPv4(parseIPv4('192.168.1.1'))).toBe('11000000.10101000.00000001.00000001');
  });
});

describe('parseIPv4Cidr', () => {
  it.each([
    ['192.168.1.10/24', 24],
    ['192.168.1.10 / 24', 24],
    ['192.168.1.10 24', 24],
    ['192.168.1.10 255.255.255.0', 24],
    ['192.168.1.10/255.255.252.0', 22],
    ['192.168.1.10', 32],
  ])('%s -> /%i', (text, prefix) => {
    expect(parseIPv4Cidr(text).prefix).toBe(prefix);
  });

  it('rejects prefixes over 32 and junk', () => {
    expect(() => parseIPv4Cidr('1.2.3.4/33')).toThrow(/out of range/);
    expect(() => parseIPv4Cidr('1.2.3.4/abc')).toThrow(/not a prefix/);
    expect(() => parseIPv4Cidr('')).toThrow(/Enter/);
  });
});

describe('ipv4Info', () => {
  it('computes a /24', () => {
    const info = ipv4Info(parseIPv4Cidr('192.168.1.10/24'));
    expect(info).toMatchObject({
      network: '192.168.1.0',
      broadcast: '192.168.1.255',
      mask: '255.255.255.0',
      wildcard: '0.0.0.255',
      firstHost: '192.168.1.1',
      lastHost: '192.168.1.254',
      totalAddresses: 256,
      usableHosts: 254,
      cidr: '192.168.1.0/24',
      ipClass: 'C',
      reverseDns: '10.1.168.192.in-addr.arpa',
      hex: '0xC0A8010A',
      integer: 3232235786,
    });
    expect(info.type.label).toMatch(/Private/);
  });

  it('computes /0', () => {
    const info = ipv4Info(parseIPv4Cidr('8.8.8.8/0'));
    expect(info.network).toBe('0.0.0.0');
    expect(info.broadcast).toBe('255.255.255.255');
    expect(info.totalAddresses).toBe(4294967296);
    expect(info.usableHosts).toBe(4294967294);
    expect(info.wildcard).toBe('255.255.255.255');
  });

  it('computes /1', () => {
    const info = ipv4Info(parseIPv4Cidr('200.1.1.1/1'));
    expect(info.network).toBe('128.0.0.0');
    expect(info.broadcast).toBe('255.255.255.255');
    expect(info.lastHost).toBe('255.255.255.254');
  });

  it('handles /31 per RFC 3021', () => {
    const info = ipv4Info(parseIPv4Cidr('10.0.0.1/31'));
    expect(info.network).toBe('10.0.0.0');
    expect(info.broadcast).toBeNull();
    expect(info.firstHost).toBe('10.0.0.0');
    expect(info.lastHost).toBe('10.0.0.1');
    expect(info.usableHosts).toBe(2);
    expect(info.note).toMatch(/3021/);
  });

  it('handles /32', () => {
    const info = ipv4Info(parseIPv4Cidr('255.255.255.255/32'));
    expect(info.network).toBe('255.255.255.255');
    expect(info.firstHost).toBe('255.255.255.255');
    expect(info.lastHost).toBe('255.255.255.255');
    expect(info.usableHosts).toBe(1);
    expect(info.totalAddresses).toBe(1);
    expect(info.type.label).toMatch(/broadcast/i);
  });

  it('handles odd prefixes', () => {
    const info = ipv4Info(parseIPv4Cidr('172.20.77.9/19'));
    expect(info.network).toBe('172.20.64.0');
    expect(info.broadcast).toBe('172.20.95.255');
    expect(info.usableHosts).toBe(8190);
  });
});

describe('classification', () => {
  it.each([
    ['10.1.2.3', /RFC 1918/, false],
    ['172.16.0.1', /RFC 1918/, false],
    ['172.31.255.255', /RFC 1918/, false],
    ['172.32.0.1', /Public/, true],
    ['192.168.0.1', /RFC 1918/, false],
    ['100.64.0.1', /CGNAT/, false],
    ['100.128.0.1', /Public/, true],
    ['127.0.0.1', /Loopback/, false],
    ['169.254.10.10', /Link-local/, false],
    ['224.0.0.251', /Multicast/, false],
    ['240.0.0.1', /Reserved/, false],
    ['192.0.2.55', /TEST-NET-1/, false],
    ['198.51.100.1', /TEST-NET-2/, false],
    ['203.0.113.7', /TEST-NET-3/, false],
    ['198.19.1.1', /Benchmarking/, false],
    ['0.1.2.3', /Unspecified/, false],
    ['8.8.8.8', /Public/, true],
  ])('%s', (ip, label, isPublic) => {
    const t = ipv4Type(parseIPv4(ip));
    expect(t.label).toMatch(label);
    expect(t.isPublic).toBe(isPublic);
  });

  it.each([
    ['1.0.0.0', 'A'],
    ['127.255.255.255', 'A'],
    ['128.0.0.0', 'B'],
    ['191.255.0.0', 'B'],
    ['192.0.0.0', 'C'],
    ['223.1.1.1', 'C'],
    ['224.0.0.0', 'D (multicast)'],
    ['255.0.0.0', 'E (reserved)'],
  ])('class of %s is %s', (ip, cls) => {
    expect(ipv4Class(parseIPv4(ip))).toBe(cls);
  });
});

describe('splitIPv4', () => {
  it('splits a /24 into /26s', () => {
    const r = splitIPv4(parseIPv4Cidr('192.168.1.0/24'), 26);
    expect(r.count).toBe(4);
    expect(r.subnets.map((s) => s.cidr)).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
      '192.168.1.128/26',
      '192.168.1.192/26',
    ]);
    expect(r.subnets[1]).toMatchObject({ firstHost: '192.168.1.65', lastHost: '192.168.1.126', broadcast: '192.168.1.127' });
    expect(r.truncated).toBe(false);
  });

  it('uses the network even when the host bits are set', () => {
    expect(splitIPv4(parseIPv4Cidr('10.0.0.77/30'), 31).subnets.map((s) => s.cidr)).toEqual(['10.0.0.76/31', '10.0.0.78/31']);
  });

  it('caps huge splits but counts exactly', () => {
    const r = splitIPv4(parseIPv4Cidr('0.0.0.0/0'), 32, 100);
    expect(r.count).toBe(4294967296);
    expect(r.subnets).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(r.subnets[99].cidr).toBe('0.0.0.99/32');
  });

  it('same prefix gives one subnet', () => {
    expect(splitIPv4(parseIPv4Cidr('10.0.0.0/8'), 8).subnets).toHaveLength(1);
  });

  it('rejects smaller prefixes', () => {
    expect(() => splitIPv4(parseIPv4Cidr('10.0.0.0/16'), 8)).toThrow(/between \/16 and \/32/);
    expect(() => splitIPv4(parseIPv4Cidr('10.0.0.0/16'), 33)).toThrow();
  });
});

describe('parseIPv6 / compress / expand', () => {
  it.each([
    ['::', '::'],
    ['::1', '::1'],
    ['0:0:0:0:0:0:0:1', '::1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'], // tie: first run wins
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'], // single zero group not compressed
    ['2001:db8::0:1', '2001:db8::1'],
    ['1::', '1::'],
    ['fe80::1%eth0', 'fe80::1'],
    ['[2001:db8::1]', '2001:db8::1'],
    ['::ffff:192.0.2.1', '::ffff:192.0.2.1'],
    ['::ffff:c000:201', '::ffff:192.0.2.1'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    ['1:0:0:2:0:0:0:3', '1:0:0:2::3'], // longest run wins
    ['0:0:1:0:0:0:0:0', '0:0:1::'],
    ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    ['64:ff9b::1.2.3.4', '64:ff9b::102:304'],
    ['1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:102:304'],
  ])('%s -> %s', (input, expected) => {
    expect(canon(input)).toBe(expected);
  });

  it('keeps the zone id', () => {
    expect(parseIPv6('fe80::1%eth0').zone).toBe('eth0');
  });

  it('expands', () => {
    expect(expandIPv6(v6('2001:db8::1'))).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(expandIPv6(v6('::'))).toBe('0000:0000:0000:0000:0000:0000:0000:0000');
  });

  it.each([
    ['', /Enter/],
    [':::', /":::"/],
    ['1::2::3', /only once/],
    ['1:2:3:4:5:6:7:8:9', /8 groups/],
    ['1:2:3:4:5:6:7', /8 groups/],
    ['12345::', /more than 4/],
    ['g::1', /not valid/],
    [':1:2:3:4:5:6:7', /single ":"/],
    ['1:2:3:4:5:6:7:', /single ":"/],
    ['1:2:3:4:5:6:7:8::', /Too many groups/],
    ['::1.2.3.256', /out of range/],
    ['fe80::1%', /zone id/],
    ['1.2::3', /not hexadecimal/],
  ])('rejects %j', (input, error) => {
    expect(() => parseIPv6(input)).toThrow(error);
  });
});

describe('ipv6Info', () => {
  it('computes a /32', () => {
    const info = ipv6Info(parseIPv6Cidr('2001:db8:abcd::1/32'));
    expect(info.network).toBe('2001:db8::');
    expect(info.last).toBe('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff');
    expect(info.totalPower).toBe(96);
    expect(info.totalAddresses).toBe(1n << 96n);
    expect(info.type.label).toMatch(/Documentation/);
    expect(info.cidr).toBe('2001:db8::/32');
    expect(info.mask).toBe('ffff:ffff::');
  });

  it('computes /0, /64, /127 and /128', () => {
    const all = ipv6Info(parseIPv6Cidr('2001:db8::1/0'));
    expect(all.network).toBe('::');
    expect(all.last).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
    expect(all.totalAddresses).toBe(1n << 128n);

    const lan = ipv6Info(parseIPv6Cidr('2001:db8:1:2:3:4:5:6/64'));
    expect(lan.network).toBe('2001:db8:1:2::');
    expect(lan.last).toBe('2001:db8:1:2:ffff:ffff:ffff:ffff');

    const p2p = ipv6Info(parseIPv6Cidr('2001:db8::3/127'));
    expect(p2p.first).toBe('2001:db8::2');
    expect(p2p.last).toBe('2001:db8::3');
    expect(p2p.totalAddresses).toBe(2n);

    const host = ipv6Info(parseIPv6Cidr('::1/128'));
    expect(host.first).toBe('::1');
    expect(host.last).toBe('::1');
    expect(host.totalAddresses).toBe(1n);
  });

  it('builds ip6.arpa names', () => {
    expect(ipv6Info(parseIPv6Cidr('2001:db8::1')).reverseDns).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
  });

  it('rejects bad prefixes', () => {
    expect(() => parseIPv6Cidr('::/129')).toThrow(/out of range/);
    expect(() => parseIPv6Cidr('::/x')).toThrow(/not a valid prefix/);
  });

  it.each([
    ['::', /Unspecified/],
    ['::1', /Loopback/],
    ['fe80::1', /Link-local/],
    ['febf::1', /Link-local/],
    ['fd12:3456::1', /Unique local/],
    ['ff02::1', /Multicast/],
    ['2001:db8::1', /Documentation/],
    ['::ffff:10.0.0.1', /IPv4-mapped/],
    ['2606:4700::1111', /Global unicast/],
    ['4000::1', /Reserved/],
  ])('type of %s', (ip, label) => {
    expect(ipv6Type(v6(ip)).label).toMatch(label);
  });
});

describe('cidrContains', () => {
  it.each([
    ['192.168.1.0/24', '192.168.1.200', true],
    ['192.168.1.0/24', '192.168.2.1', false],
    ['0.0.0.0/0', '1.2.3.4', true],
    ['10.0.0.5/32', '10.0.0.5', true],
    ['10.0.0.5/32', '10.0.0.6', false],
    ['10.0.0.0 255.0.0.0', '10.255.255.255', true],
    ['2001:db8::/32', '2001:db8:ffff::1', true],
    ['2001:db8::/32', '2001:db9::1', false],
    ['::/0', 'ff02::1', true],
    ['fe80::/10', 'fe80::1%eth0', true],
  ])('%s contains %s = %s', (block, ip, expected) => {
    expect(cidrContains(block, ip).contains).toBe(expected);
  });

  it('reports the normalized network', () => {
    expect(cidrContains('192.168.1.77/24', '192.168.1.1').network).toBe('192.168.1.0/24');
  });

  it('rejects mixed families', () => {
    expect(() => cidrContains('10.0.0.0/8', '::1')).toThrow(/IPv4 but the address is IPv6/);
  });

  it('rejects empty inputs', () => {
    expect(() => cidrContains('', '1.1.1.1')).toThrow(/CIDR/);
    expect(() => cidrContains('1.1.1.0/24', '')).toThrow(/address/);
  });
});

describe('formatBig', () => {
  it('adds separators', () => {
    expect(formatBig(1n << 64n)).toBe('18,446,744,073,709,551,616');
    expect(formatBig(12n)).toBe('12');
  });
});
