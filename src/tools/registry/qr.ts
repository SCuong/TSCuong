import { Barcode, QrCode, ScanLine } from 'lucide-react';
import type { ToolDefinition } from '../types';

export const qrTools: ToolDefinition[] = [
  {
    id: 'qr-generator',
    name: 'QR Code Generator',
    description: 'Make QR codes for links, text, Wi-Fi, contacts (vCard), email, phone, SMS, locations and events, as PNG or SVG.',
    category: 'qr',
    icon: QrCode,
    route: 'qr/generator',
    priority: 2,
    keywords: [
      'qr', 'qr code', 'generate', 'generator', 'create', 'wifi', 'wi-fi', 'vcard', 'contact', 'url', 'link', 'email', 'sms', 'phone',
      'geo', 'location', 'calendar', 'event', 'png', 'svg',
    ],
    aliases: ['wifi qr', 'vcard qr', 'qr code generator', 'url to qr', 'make qr code', 'generate qr', 'wifi qr code', 'contact qr code'],
    load: () => import('../qr/QrGenerator'),
  },
  {
    id: 'qr-scanner',
    name: 'QR & Barcode Scanner',
    description: 'Read QR codes and barcodes from an image or your camera: QR, Data Matrix, Aztec, PDF417, EAN/UPC, Code 128 and more.',
    category: 'qr',
    icon: ScanLine,
    route: 'qr/scanner',
    keywords: [
      'scan', 'scanner', 'reader', 'read', 'decode', 'qr', 'barcode', 'camera', 'webcam', 'data matrix', 'aztec', 'pdf417', 'ean', 'upc',
      'code128', 'wifi', 'image',
    ],
    aliases: ['scan qr', 'qr reader', 'barcode reader', 'scan barcode', 'decode qr', 'read qr code from image', 'qr code scanner'],
    requires: ['webAssembly'],
    load: () => import('../qr/QrScanner'),
  },
  {
    id: 'barcode-generator',
    name: 'Barcode Generator',
    description: 'Create Code 128, EAN-13, UPC, Code 39, ITF-14, MSI, Pharmacode and Codabar barcodes with check-digit validation.',
    category: 'qr',
    icon: Barcode,
    route: 'qr/barcode',
    keywords: ['barcode', 'generator', 'code128', 'ean', 'ean13', 'ean8', 'upc', 'upca', 'upce', 'code39', 'itf', 'itf14', 'msi', 'pharmacode', 'codabar', 'gtin', 'svg', 'png'],
    aliases: ['barcode generator', 'ean 13 generator', 'upc barcode', 'make barcode', 'code 128 generator'],
    load: () => import('../qr/BarcodeGenerator'),
  },
];
