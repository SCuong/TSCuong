/** Display names for X.509 extension, EKU, policy and key-usage identifiers. */

export const EXTENSION_NAMES: Record<string, string> = {
  '2.5.29.14': 'Subject key identifier',
  '2.5.29.15': 'Key usage',
  '2.5.29.17': 'Subject alternative name',
  '2.5.29.18': 'Issuer alternative name',
  '2.5.29.19': 'Basic constraints',
  '2.5.29.30': 'Name constraints',
  '2.5.29.31': 'CRL distribution points',
  '2.5.29.32': 'Certificate policies',
  '2.5.29.33': 'Policy mappings',
  '2.5.29.35': 'Authority key identifier',
  '2.5.29.36': 'Policy constraints',
  '2.5.29.37': 'Extended key usage',
  '2.5.29.46': 'Freshest CRL',
  '2.5.29.54': 'Inhibit any-policy',
  '2.5.29.9': 'Subject directory attributes',
  '1.3.6.1.5.5.7.1.1': 'Authority information access',
  '1.3.6.1.5.5.7.1.11': 'Subject information access',
  '1.3.6.1.5.5.7.1.3': 'Qualified certificate statements',
  '1.3.6.1.5.5.7.1.24': 'TLS feature (OCSP Must-Staple)',
  '1.3.6.1.4.1.11129.2.4.2': 'Signed certificate timestamps (CT)',
  '1.3.6.1.4.1.11129.2.4.3': 'CT precertificate poison',
  '1.3.6.1.5.5.7.48.1.5': 'OCSP no check',
  '1.3.6.1.4.1.311.21.7': 'Microsoft certificate template',
  '1.3.6.1.4.1.311.21.10': 'Microsoft application policies',
  '1.3.6.1.4.1.311.20.2': 'Microsoft certificate template name',
  '1.3.6.1.4.1.311.21.1': 'Microsoft CA version',
  '2.16.840.1.113730.1.1': 'Netscape certificate type',
  '2.16.840.1.113730.1.13': 'Netscape comment',
};

export const EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS server authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS client authentication',
  '1.3.6.1.5.5.7.3.3': 'Code signing',
  '1.3.6.1.5.5.7.3.4': 'Email protection (S/MIME)',
  '1.3.6.1.5.5.7.3.5': 'IPsec end system',
  '1.3.6.1.5.5.7.3.6': 'IPsec tunnel',
  '1.3.6.1.5.5.7.3.7': 'IPsec user',
  '1.3.6.1.5.5.7.3.8': 'Time stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP signing',
  '1.3.6.1.5.5.7.3.17': 'IPsec IKE',
  '1.3.6.1.5.2.3.5': 'Kerberos KDC',
  '1.3.6.1.4.1.311.20.2.2': 'Smart card logon',
  '1.3.6.1.4.1.311.10.3.12': 'Document signing',
  '1.3.6.1.4.1.311.10.3.4': 'Encrypting file system',
  '1.3.6.1.4.1.311.10.3.3': 'Microsoft server gated crypto',
  '2.16.840.1.113730.4.1': 'Netscape server gated crypto',
  '1.3.6.1.4.1.11129.2.4.4': 'Certificate Transparency precertificate signing',
  '2.5.29.37.0': 'Any extended key usage',
};

export const POLICY_NAMES: Record<string, string> = {
  '2.5.29.32.0': 'Any policy',
  '2.23.140.1.1': 'Extended validation (EV)',
  '2.23.140.1.2.1': 'Domain validated (DV)',
  '2.23.140.1.2.2': 'Organization validated (OV)',
  '2.23.140.1.2.3': 'Individual validated (IV)',
  '2.23.140.1.3': 'EV code signing',
  '2.23.140.1.4.1': 'Code signing',
  '1.3.6.1.4.1.44947.1.1.1': 'ISRG domain validated (Let’s Encrypt)',
};

/** Key usage bits in the order of @peculiar/x509's KeyUsageFlags (1, 2, 4, ... 256). */
export const KEY_USAGE_NAMES = [
  'Digital signature',
  'Non-repudiation',
  'Key encipherment',
  'Data encipherment',
  'Key agreement',
  'Certificate signing',
  'CRL signing',
  'Encipher only',
  'Decipher only',
] as const;

export function keyUsageNames(flags: number): string[] {
  return KEY_USAGE_NAMES.filter((_, i) => (flags & (1 << i)) !== 0);
}

/** Short names for distinguished name attribute OIDs that @peculiar/x509 prints numerically. */
export const DN_ATTRIBUTE_NAMES: Record<string, string> = {
  CN: 'Common name',
  O: 'Organization',
  OU: 'Organizational unit',
  C: 'Country',
  L: 'Locality',
  ST: 'State or province',
  STREET: 'Street',
  DC: 'Domain component',
  E: 'Email',
  UID: 'User ID',
  SERIALNUMBER: 'Serial number',
  G: 'Given name',
  SN: 'Surname',
  T: 'Title',
  '2.5.4.5': 'Serial number',
  '1.2.840.113549.1.9.1': 'Email',
  '2.5.4.97': 'Organization identifier',
  '1.3.6.1.4.1.311.60.2.1.3': 'Jurisdiction country',
  '1.3.6.1.4.1.311.60.2.1.2': 'Jurisdiction state',
  '2.5.4.15': 'Business category',
  '2.5.4.17': 'Postal code',
};
