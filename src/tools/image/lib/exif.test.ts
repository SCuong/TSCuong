import { describe, expect, it } from 'vitest';
import { formatCoord, formatMetaValue, gpsFromGroups, osmUrl, summarizeMetadata } from './exif';
import { formatDms, formatExposureTime, formatTagValue, groupForDisplay, humanizeKey, metadataToJson } from './exifGroups';

describe('exif helpers', () => {
  it('converts GPS DMS with refs to decimal', () => {
    expect(gpsFromGroups({ gps: { GPSLatitude: [48, 51, 29.4], GPSLatitudeRef: 'N', GPSLongitude: [2, 17, 40.2], GPSLongitudeRef: 'W' } })).toEqual({
      latitude: 48 + 51 / 60 + 29.4 / 3600,
      longitude: -(2 + 17 / 60 + 40.2 / 3600),
    });
    expect(gpsFromGroups({ gps: { latitude: -33.9, longitude: 151.2 } })).toEqual({ latitude: -33.9, longitude: 151.2 });
    expect(gpsFromGroups({ gps: { latitude: 0, longitude: 0 } })).toBeNull();
    expect(gpsFromGroups({ gps: { latitude: 200, longitude: 0 } })).toBeNull();
    expect(gpsFromGroups({})).toBeNull();
  });

  it('summarizes camera, date and counts', () => {
    const s = summarizeMetadata({
      ifd0: { Make: 'Canon', Model: 'Canon EOS R5', Orientation: 1 },
      exif: { DateTimeOriginal: new Date(2024, 0, 2, 3, 4, 5), ISO: 100 },
      xmp: { CreatorTool: 'x' },
      jfif: { JFIFVersion: 257 },
    });
    expect(s.camera).toBe('Canon EOS R5');
    expect(s.exifTags).toBe(5);
    expect(s.hasXmp).toBe(true);
    expect(s.hasIptc).toBe(false);
    expect(s.total).toBe(6);
    expect(s.date).toBeTruthy();
  });

  it('formats coordinates and links', () => {
    expect(formatCoord(48.8, -2.5)).toBe('48.800000° N, 2.500000° W');
    expect(osmUrl(1, 2)).toBe('https://www.openstreetmap.org/?mlat=1.000000&mlon=2.000000#map=15/1.000000/2.000000');
  });

  it('formats values', () => {
    expect(formatMetaValue(new Uint8Array(4))).toBe('4 bytes of binary data');
    expect(formatMetaValue([1, 2])).toBe('1, 2');
    expect(formatMetaValue(1 / 3)).toBe('0.333333');
    expect(formatMetaValue('abc\0\0')).toBe('abc');
    expect(formatExposureTime(0.004)).toBe('1/250 s');
    expect(formatExposureTime(2.5)).toBe('2.5 s');
    expect(formatTagValue('FNumber', 2.8)).toBe('f/2.8');
    expect(formatTagValue('FocalLength', 50)).toBe('50 mm');
    expect(formatTagValue('ExposureCompensation', -0.667)).toBe('-0.67 EV');
    expect(formatTagValue('GPSLatitude', [48, 51, 29.4])).toBe('48° 51′ 29.4″');
    expect(formatDms([1])).toBe('1° 0′ 0″');
  });

  it('humanizes keys', () => {
    expect(humanizeKey('ExposureTime')).toBe('Exposure time');
    expect(humanizeKey('GPSLatitudeRef')).toBe('GPS latitude ref');
    expect(humanizeKey('ISO')).toBe('ISO');
    expect(humanizeKey('RedTRC')).toBe('Red TRC');
  });

  it('groups tags for display and skips binary/JFIF', () => {
    const groups = groupForDisplay({
      ifd0: { Make: 'Sony', ModifyDate: '2020', XResolution: 72 },
      exif: { ExposureTime: 0.01, ISO: 200 },
      gps: { GPSLatitude: [1, 2, 3] },
      icc: { ProfileDescription: 'sRGB', RedTRC: new Uint8Array(3) },
      jfif: { JFIFVersion: 257 },
      ifd1: { ImageWidth: 160 },
    });
    const byId = Object.fromEntries(groups.map((g) => [g.id, g.rows]));
    expect(byId.camera.map((r) => r.label)).toEqual(['Make']);
    expect(byId.dates.map((r) => r.label)).toEqual(['Modify date']);
    expect(byId.exposure.map((r) => r.value)).toEqual(['1/100 s', '200']);
    expect(byId.icc).toHaveLength(1);
    expect(byId.image.map((r) => r.label)).toEqual(['X resolution', 'Thumbnail image width']);
    expect(groups.find((g) => g.id === 'other')).toBeUndefined();
  });

  it('serializes to JSON safely', () => {
    // Dates keep the wall-clock time written in the file (EXIF dates have no time zone).
    const json = metadataToJson({ a: { d: new Date(2020, 0, 1, 0, 0, 0), b: new Uint8Array(5) } });
    expect(JSON.parse(json)).toEqual({ a: { d: '2020-01-01 00:00:00', b: '<5 bytes>' } });
  });
});
