export type PortProtocol = 'TCP' | 'UDP' | 'TCP/UDP';

export type PortCategory =
  | 'Web'
  | 'Mail'
  | 'File transfer'
  | 'Remote access'
  | 'Database'
  | 'Messaging'
  | 'Directory & auth'
  | 'Infrastructure'
  | 'Monitoring'
  | 'Development'
  | 'Media & VoIP'
  | 'VPN & tunneling'
  | 'Containers & cloud'
  | 'Gaming';

export interface PortEntry {
  port: number;
  protocol: PortProtocol;
  service: string;
  description: string;
  category: PortCategory;
  /** Used by convention or by one product, but not IANA-assigned for this purpose. */
  unofficial?: boolean;
  note?: string;
}

const P = (
  port: number,
  protocol: PortProtocol,
  service: string,
  category: PortCategory,
  description: string,
  extra: { unofficial?: boolean; note?: string } = {},
): PortEntry => ({ port, protocol, service, category, description, ...extra });

export const PORTS: PortEntry[] = [
  P(7, 'TCP/UDP', 'Echo', 'Infrastructure', 'Echo protocol: returns whatever it receives. Used for testing; usually disabled.'),
  P(20, 'TCP', 'FTP data', 'File transfer', 'FTP data channel in active mode.', { note: 'Unencrypted; prefer SFTP or FTPS.' }),
  P(21, 'TCP', 'FTP', 'File transfer', 'FTP control channel (commands and replies).', { note: 'Sends credentials in clear text; prefer SFTP (22).' }),
  P(22, 'TCP', 'SSH / SFTP / SCP', 'Remote access', 'Secure Shell for remote logins, tunnels and file transfer (SFTP, SCP).'),
  P(23, 'TCP', 'Telnet', 'Remote access', 'Unencrypted remote terminal.', { note: 'Insecure; use SSH (22) instead.' }),
  P(25, 'TCP', 'SMTP', 'Mail', 'Mail transfer between servers. Often blocked outbound by ISPs for home users.'),
  P(43, 'TCP', 'WHOIS', 'Directory & auth', 'Domain and IP registration lookups.'),
  P(49, 'TCP', 'TACACS+', 'Directory & auth', 'Authentication, authorization and accounting for network devices.'),
  P(53, 'TCP/UDP', 'DNS', 'Infrastructure', 'Domain Name System. UDP for most queries; TCP for large responses and zone transfers.'),
  P(67, 'UDP', 'DHCP server', 'Infrastructure', 'DHCP/BOOTP server: hands out IP addresses.'),
  P(68, 'UDP', 'DHCP client', 'Infrastructure', 'DHCP/BOOTP client side.'),
  P(69, 'UDP', 'TFTP', 'File transfer', 'Trivial File Transfer Protocol, used for network boot and device firmware.', { note: 'No authentication.' }),
  P(80, 'TCP', 'HTTP', 'Web', 'Unencrypted web traffic. Usually redirects to HTTPS (443).'),
  P(88, 'TCP/UDP', 'Kerberos', 'Directory & auth', 'Kerberos authentication, used by Active Directory.'),
  P(110, 'TCP', 'POP3', 'Mail', 'Post Office Protocol v3 for downloading mail.', { note: 'Unencrypted; prefer POP3S (995).' }),
  P(111, 'TCP/UDP', 'rpcbind', 'Infrastructure', 'ONC RPC port mapper, used by NFS v3 and other RPC services.'),
  P(119, 'TCP', 'NNTP', 'Messaging', 'Network News Transfer Protocol (Usenet).'),
  P(123, 'UDP', 'NTP', 'Infrastructure', 'Network Time Protocol for clock synchronization.'),
  P(135, 'TCP/UDP', 'MS RPC', 'Infrastructure', 'Microsoft RPC endpoint mapper (DCOM, WMI).', { note: 'Should never be exposed to the internet.' }),
  P(137, 'UDP', 'NetBIOS name', 'Infrastructure', 'NetBIOS name service (legacy Windows networking).'),
  P(138, 'UDP', 'NetBIOS datagram', 'Infrastructure', 'NetBIOS datagram service (legacy Windows networking).'),
  P(139, 'TCP', 'NetBIOS session', 'File transfer', 'NetBIOS session service, used by SMB over NetBIOS.'),
  P(143, 'TCP', 'IMAP', 'Mail', 'Internet Message Access Protocol for reading mail on the server.', { note: 'Use STARTTLS or IMAPS (993).' }),
  P(161, 'UDP', 'SNMP', 'Monitoring', 'Simple Network Management Protocol queries to devices.'),
  P(162, 'UDP', 'SNMP trap', 'Monitoring', 'SNMP traps (notifications sent by devices).'),
  P(179, 'TCP', 'BGP', 'Infrastructure', 'Border Gateway Protocol, the routing protocol between networks on the internet.'),
  P(194, 'TCP', 'IRC', 'Messaging', 'Internet Relay Chat (officially assigned; most servers use 6667).'),
  P(389, 'TCP/UDP', 'LDAP', 'Directory & auth', 'Lightweight Directory Access Protocol (Active Directory, OpenLDAP).'),
  P(427, 'TCP/UDP', 'SLP', 'Infrastructure', 'Service Location Protocol for discovering services on a LAN.'),
  P(443, 'TCP', 'HTTPS', 'Web', 'HTTP over TLS: secure web traffic (HTTP/1.1 and HTTP/2).'),
  P(443, 'UDP', 'HTTP/3 (QUIC)', 'Web', 'HTTP/3 runs over QUIC on UDP 443.'),
  P(445, 'TCP', 'SMB', 'File transfer', 'Server Message Block / CIFS file and printer sharing (Windows shares, Samba).', {
    note: 'Never expose to the internet.',
  }),
  P(464, 'TCP/UDP', 'Kerberos password', 'Directory & auth', 'Kerberos password change (kpasswd).'),
  P(465, 'TCP', 'SMTPS', 'Mail', 'Mail submission over implicit TLS.'),
  P(500, 'UDP', 'IKE (IPsec)', 'VPN & tunneling', 'Internet Key Exchange for IPsec VPNs.'),
  P(514, 'UDP', 'Syslog', 'Monitoring', 'Classic syslog message collection.'),
  P(515, 'TCP', 'LPD', 'Infrastructure', 'Line Printer Daemon printing protocol.'),
  P(520, 'UDP', 'RIP', 'Infrastructure', 'Routing Information Protocol.'),
  P(546, 'UDP', 'DHCPv6 client', 'Infrastructure', 'DHCPv6 client side.'),
  P(547, 'UDP', 'DHCPv6 server', 'Infrastructure', 'DHCPv6 server side.'),
  P(554, 'TCP/UDP', 'RTSP', 'Media & VoIP', 'Real Time Streaming Protocol for controlling media streams (IP cameras).'),
  P(587, 'TCP', 'SMTP submission', 'Mail', 'Mail submission from clients to their provider, with STARTTLS and authentication.'),
  P(631, 'TCP/UDP', 'IPP / CUPS', 'Infrastructure', 'Internet Printing Protocol.'),
  P(636, 'TCP', 'LDAPS', 'Directory & auth', 'LDAP over TLS.'),
  P(853, 'TCP', 'DNS over TLS', 'Infrastructure', 'Encrypted DNS (DoT).'),
  P(873, 'TCP', 'rsync', 'File transfer', 'rsync daemon for file synchronization.'),
  P(989, 'TCP', 'FTPS data', 'File transfer', 'FTP data over implicit TLS.'),
  P(990, 'TCP', 'FTPS', 'File transfer', 'FTP control over implicit TLS.'),
  P(993, 'TCP', 'IMAPS', 'Mail', 'IMAP over implicit TLS.'),
  P(995, 'TCP', 'POP3S', 'Mail', 'POP3 over implicit TLS.'),
  P(1080, 'TCP', 'SOCKS', 'VPN & tunneling', 'SOCKS proxy.'),
  P(1194, 'TCP/UDP', 'OpenVPN', 'VPN & tunneling', 'OpenVPN default port (UDP is typical).'),
  P(1433, 'TCP', 'Microsoft SQL Server', 'Database', 'Default SQL Server database engine port.'),
  P(1434, 'UDP', 'SQL Server Browser', 'Database', 'Helps clients find named SQL Server instances.'),
  P(1521, 'TCP', 'Oracle Database', 'Database', 'Oracle TNS listener.'),
  P(1701, 'UDP', 'L2TP', 'VPN & tunneling', 'Layer 2 Tunneling Protocol (usually with IPsec).'),
  P(1723, 'TCP', 'PPTP', 'VPN & tunneling', 'Point-to-Point Tunneling Protocol.', { note: 'Cryptographically broken; avoid.' }),
  P(1812, 'UDP', 'RADIUS', 'Directory & auth', 'RADIUS authentication.'),
  P(1813, 'UDP', 'RADIUS accounting', 'Directory & auth', 'RADIUS accounting.'),
  P(1883, 'TCP', 'MQTT', 'Messaging', 'MQTT publish/subscribe messaging (IoT), unencrypted.'),
  P(1900, 'UDP', 'SSDP / UPnP', 'Infrastructure', 'Simple Service Discovery Protocol, used by UPnP.'),
  P(2049, 'TCP/UDP', 'NFS', 'File transfer', 'Network File System.'),
  P(2181, 'TCP', 'ZooKeeper', 'Infrastructure', 'Apache ZooKeeper client port.'),
  P(2375, 'TCP', 'Docker API', 'Containers & cloud', 'Docker Engine API without TLS.', { note: 'Grants root-level control; never expose it.' }),
  P(2376, 'TCP', 'Docker API (TLS)', 'Containers & cloud', 'Docker Engine API with TLS.'),
  P(2377, 'TCP', 'Docker Swarm', 'Containers & cloud', 'Docker Swarm cluster management.'),
  P(2379, 'TCP', 'etcd client', 'Containers & cloud', 'etcd key-value store client API (Kubernetes backing store).'),
  P(2380, 'TCP', 'etcd peer', 'Containers & cloud', 'etcd server-to-server communication.'),
  P(3000, 'TCP', 'Dev server / Grafana', 'Development', 'Common default for Node.js/React dev servers, Ruby on Rails and Grafana.', { unofficial: true }),
  P(3128, 'TCP', 'Squid proxy', 'Web', 'Squid HTTP proxy default.', { unofficial: true }),
  P(3268, 'TCP', 'AD Global Catalog', 'Directory & auth', 'Active Directory Global Catalog (LDAP).'),
  P(3269, 'TCP', 'AD Global Catalog (TLS)', 'Directory & auth', 'Active Directory Global Catalog over TLS.'),
  P(3306, 'TCP', 'MySQL / MariaDB', 'Database', 'MySQL and MariaDB server.'),
  P(3389, 'TCP/UDP', 'RDP', 'Remote access', 'Windows Remote Desktop Protocol.', { note: 'Frequently attacked; put it behind a VPN.' }),
  P(3478, 'TCP/UDP', 'STUN / TURN', 'Media & VoIP', 'NAT traversal for WebRTC and VoIP.'),
  P(3690, 'TCP', 'Subversion', 'Development', 'svnserve protocol.'),
  P(4000, 'TCP', 'Dev server', 'Development', 'Common default for Jekyll, Phoenix and other dev servers.', { unofficial: true }),
  P(4200, 'TCP', 'Angular CLI', 'Development', 'Angular development server default.', { unofficial: true }),
  P(4222, 'TCP', 'NATS', 'Messaging', 'NATS messaging client port.'),
  P(4369, 'TCP', 'EPMD', 'Messaging', 'Erlang Port Mapper Daemon (RabbitMQ, CouchDB clustering).'),
  P(4443, 'TCP', 'Alternate HTTPS', 'Web', 'Commonly used alternative HTTPS port.', { unofficial: true }),
  P(4500, 'UDP', 'IPsec NAT-T', 'VPN & tunneling', 'IPsec NAT traversal.'),
  P(5000, 'TCP', 'Flask / Docker registry', 'Development', 'Default for Flask dev server and Docker Registry; macOS AirPlay Receiver also uses it.', {
    unofficial: true,
  }),
  P(5044, 'TCP', 'Logstash Beats', 'Monitoring', 'Logstash input for Elastic Beats.', { unofficial: true }),
  P(5060, 'TCP/UDP', 'SIP', 'Media & VoIP', 'Session Initiation Protocol for VoIP signalling.'),
  P(5061, 'TCP', 'SIP over TLS', 'Media & VoIP', 'Encrypted SIP signalling.'),
  P(5173, 'TCP', 'Vite', 'Development', 'Vite development server default.', { unofficial: true }),
  P(5222, 'TCP', 'XMPP client', 'Messaging', 'XMPP (Jabber) client connections.'),
  P(5269, 'TCP', 'XMPP server', 'Messaging', 'XMPP server-to-server federation.'),
  P(5353, 'UDP', 'mDNS', 'Infrastructure', 'Multicast DNS (Bonjour, Avahi) for local name discovery.'),
  P(5432, 'TCP', 'PostgreSQL', 'Database', 'PostgreSQL server.'),
  P(5601, 'TCP', 'Kibana', 'Monitoring', 'Kibana web interface.', { unofficial: true }),
  P(5671, 'TCP', 'AMQPS', 'Messaging', 'AMQP over TLS.'),
  P(5672, 'TCP', 'AMQP', 'Messaging', 'AMQP messaging (RabbitMQ).'),
  P(5900, 'TCP', 'VNC', 'Remote access', 'Virtual Network Computing remote desktop (display :0).', { note: 'Often weakly protected; tunnel it.' }),
  P(5984, 'TCP', 'CouchDB', 'Database', 'Apache CouchDB HTTP API.'),
  P(5985, 'TCP', 'WinRM (HTTP)', 'Remote access', 'Windows Remote Management / PowerShell remoting over HTTP.'),
  P(5986, 'TCP', 'WinRM (HTTPS)', 'Remote access', 'Windows Remote Management over HTTPS.'),
  P(6379, 'TCP', 'Redis', 'Database', 'Redis server.', { note: 'Do not expose without authentication.' }),
  P(6443, 'TCP', 'Kubernetes API', 'Containers & cloud', 'Kubernetes API server.', { unofficial: true }),
  P(6514, 'TCP', 'Syslog over TLS', 'Monitoring', 'Encrypted syslog.'),
  P(6660, 'TCP', 'IRC (alt range)', 'Messaging', 'IRC servers commonly listen on 6660–6669.', { unofficial: true }),
  P(6667, 'TCP', 'IRC', 'Messaging', 'The most common IRC server port.', { unofficial: true }),
  P(6697, 'TCP', 'IRC over TLS', 'Messaging', 'IRC over TLS.'),
  P(7000, 'TCP', 'Cassandra inter-node', 'Database', 'Apache Cassandra cluster communication.', { unofficial: true }),
  P(8000, 'TCP', 'Alternate HTTP', 'Web', 'Common alternative HTTP port (Django dev server, Python http.server).', { unofficial: true }),
  P(8008, 'TCP', 'Alternate HTTP', 'Web', 'Alternative HTTP port.', { unofficial: true }),
  P(8080, 'TCP', 'HTTP alternate / proxy', 'Web', 'Common alternative HTTP port for app servers (Tomcat, Jenkins) and proxies.'),
  P(8081, 'TCP', 'Alternate HTTP', 'Web', 'Frequently used for secondary web apps and admin UIs.', { unofficial: true }),
  P(8086, 'TCP', 'InfluxDB', 'Database', 'InfluxDB HTTP API.', { unofficial: true }),
  P(8088, 'TCP', 'Alternate HTTP', 'Web', 'Alternative HTTP port (Hadoop YARN UI and others).', { unofficial: true }),
  P(8200, 'TCP', 'HashiCorp Vault', 'Directory & auth', 'Vault API default.', { unofficial: true }),
  P(8443, 'TCP', 'Alternate HTTPS', 'Web', 'Common alternative HTTPS port (admin consoles, Tomcat TLS).', { unofficial: true }),
  P(8500, 'TCP', 'Consul', 'Infrastructure', 'HashiCorp Consul HTTP API.', { unofficial: true }),
  P(8883, 'TCP', 'MQTT over TLS', 'Messaging', 'Secure MQTT.'),
  P(8888, 'TCP', 'Jupyter / alt HTTP', 'Development', 'Jupyter Notebook default and a common alternative HTTP port.', { unofficial: true }),
  P(9000, 'TCP', 'PHP-FPM / SonarQube / MinIO', 'Development', 'Used by PHP-FPM (FastCGI), SonarQube, MinIO and Portainer.', { unofficial: true }),
  P(9042, 'TCP', 'Cassandra CQL', 'Database', 'Apache Cassandra native client protocol.', { unofficial: true }),
  P(9090, 'TCP', 'Prometheus', 'Monitoring', 'Prometheus server and web UI.', { unofficial: true }),
  P(9092, 'TCP', 'Apache Kafka', 'Messaging', 'Kafka broker.', { unofficial: true }),
  P(9093, 'TCP', 'Alertmanager', 'Monitoring', 'Prometheus Alertmanager.', { unofficial: true }),
  P(9100, 'TCP', 'Node exporter / raw printing', 'Monitoring', 'Prometheus node_exporter; also JetDirect raw printing.', { unofficial: true }),
  P(9200, 'TCP', 'Elasticsearch HTTP', 'Database', 'Elasticsearch / OpenSearch REST API.', { unofficial: true }),
  P(9300, 'TCP', 'Elasticsearch transport', 'Database', 'Elasticsearch node-to-node communication.', { unofficial: true }),
  P(9418, 'TCP', 'Git', 'Development', 'Git native protocol (git://), unauthenticated.'),
  P(9443, 'TCP', 'Alternate HTTPS', 'Web', 'Alternative HTTPS port (Portainer, admin consoles).', { unofficial: true }),
  P(10250, 'TCP', 'Kubelet API', 'Containers & cloud', 'Kubernetes kubelet API.', { unofficial: true }),
  P(11211, 'TCP/UDP', 'Memcached', 'Database', 'Memcached.', { note: 'Disable UDP to prevent amplification attacks.' }),
  P(15672, 'TCP', 'RabbitMQ management', 'Messaging', 'RabbitMQ management web UI.', { unofficial: true }),
  P(25565, 'TCP', 'Minecraft', 'Gaming', 'Minecraft Java Edition server.', { unofficial: true }),
  P(19132, 'UDP', 'Minecraft Bedrock', 'Gaming', 'Minecraft Bedrock Edition server.', { unofficial: true }),
  P(27015, 'TCP/UDP', 'Source engine', 'Gaming', 'Steam / Source engine game servers.', { unofficial: true }),
  P(27017, 'TCP', 'MongoDB', 'Database', 'MongoDB server.'),
  P(3074, 'TCP/UDP', 'Xbox Live', 'Gaming', 'Xbox network multiplayer.'),
  P(28015, 'TCP', 'RethinkDB', 'Database', 'RethinkDB client driver port.', { unofficial: true }),
  P(32400, 'TCP', 'Plex', 'Media & VoIP', 'Plex Media Server.', { unofficial: true }),
  P(50000, 'TCP', 'Jenkins agents / SAP', 'Development', 'Jenkins inbound agents (JNLP) and some SAP services.', { unofficial: true }),
  P(51820, 'UDP', 'WireGuard', 'VPN & tunneling', 'WireGuard VPN default.', { unofficial: true }),
  P(3001, 'TCP', 'Dev server (alt)', 'Development', 'Second instance of a Node.js dev server.', { unofficial: true }),
  P(4173, 'TCP', 'Vite preview', 'Development', 'Vite production preview server default.', { unofficial: true }),
  P(6006, 'TCP', 'Storybook / TensorBoard', 'Development', 'Storybook and TensorBoard defaults.', { unofficial: true }),
  P(8025, 'TCP', 'MailHog / Mailpit UI', 'Development', 'Web UI of local mail catchers.', { unofficial: true }),
  P(1025, 'TCP', 'Local SMTP catcher', 'Development', 'SMTP port used by MailHog/Mailpit in development.', { unofficial: true }),
  P(9229, 'TCP', 'Node.js inspector', 'Development', 'Node.js --inspect debugging protocol.', { unofficial: true }),
  P(5005, 'TCP', 'Java debug (JDWP)', 'Development', 'Common JDWP remote debugging port.', { unofficial: true }),
  P(8761, 'TCP', 'Eureka', 'Containers & cloud', 'Netflix Eureka service registry.', { unofficial: true }),
  P(7474, 'TCP', 'Neo4j HTTP', 'Database', 'Neo4j browser and HTTP API.', { unofficial: true }),
  P(7687, 'TCP', 'Neo4j Bolt', 'Database', 'Neo4j Bolt protocol.', { unofficial: true }),
  P(8123, 'TCP', 'ClickHouse HTTP / Home Assistant', 'Database', 'ClickHouse HTTP interface and Home Assistant web UI.', { unofficial: true }),
  P(9001, 'TCP', 'MinIO console / Tor', 'Development', 'MinIO console and Tor ORPort defaults.', { unofficial: true }),
  P(9050, 'TCP', 'Tor SOCKS', 'VPN & tunneling', 'Tor SOCKS proxy.', { unofficial: true }),
  P(1935, 'TCP', 'RTMP', 'Media & VoIP', 'Real-Time Messaging Protocol for live streaming ingest.'),
  P(5349, 'TCP', 'TURN over TLS', 'Media & VoIP', 'STUN/TURN over TLS.'),
  P(10000, 'TCP', 'Webmin', 'Remote access', 'Webmin administration panel.', { unofficial: true }),
];

export type PortRange = 'Well-known' | 'Registered' | 'Dynamic / private';

export function portRange(port: number): PortRange {
  if (port <= 1023) return 'Well-known';
  if (port <= 49151) return 'Registered';
  return 'Dynamic / private';
}

export const RANGE_INFO: Record<PortRange, string> = {
  'Well-known': '0–1023: system ports assigned by IANA; binding them usually needs admin rights.',
  Registered: '1024–49151: user ports that IANA registers for specific services.',
  'Dynamic / private': '49152–65535: ephemeral ports for temporary client connections; not registered.',
};

export interface PortQuery {
  text: string;
  protocol: 'all' | 'TCP' | 'UDP';
  category: PortCategory | 'all';
}

export type ParsedPortQuery =
  | { kind: 'empty' }
  | { kind: 'port'; port: number }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'text'; words: string[] }
  | { kind: 'invalid'; message: string };

export function parsePortQuery(text: string): ParsedPortQuery {
  const s = text.trim().toLowerCase();
  if (!s) return { kind: 'empty' };
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > 65535 || to > 65535) return { kind: 'invalid', message: 'Ports go from 0 to 65535.' };
    return { kind: 'range', from: Math.min(from, to), to: Math.max(from, to) };
  }
  if (/^\d+$/.test(s)) {
    const port = Number(s);
    if (port > 65535) return { kind: 'invalid', message: `${s} is not a valid port (0–65535).` };
    return { kind: 'port', port };
  }
  return { kind: 'text', words: s.split(/\s+/) };
}

function matchesProtocol(entry: PortEntry, protocol: PortQuery['protocol']): boolean {
  return protocol === 'all' || entry.protocol === protocol || entry.protocol === 'TCP/UDP';
}

export function filterPorts(list: PortEntry[], query: PortQuery): PortEntry[] {
  const parsed = parsePortQuery(query.text);
  const out = list.filter((p) => {
    if (!matchesProtocol(p, query.protocol)) return false;
    if (query.category !== 'all' && p.category !== query.category) return false;
    switch (parsed.kind) {
      case 'empty':
        return true;
      case 'invalid':
        return false;
      case 'port':
        return p.port === parsed.port;
      case 'range':
        return p.port >= parsed.from && p.port <= parsed.to;
      case 'text': {
        const hay = `${p.port} ${p.service} ${p.description} ${p.category} ${p.protocol} ${p.note ?? ''}`.toLowerCase();
        return parsed.words.every((w) => hay.includes(w));
      }
    }
  });
  return out.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}
