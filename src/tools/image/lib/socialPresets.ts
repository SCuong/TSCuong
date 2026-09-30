import { t } from '@/lib/i18n';
/** Social media image sizes (generic labels, no brand assets). */
export interface SocialPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  note?: string;
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: 'og', label: t('Open Graph link preview'), width: 1200, height: 630, note: 'Used by most sites and chat apps when a link is shared (og:image).' },
  { id: 'x-large', label: t('X / Twitter large card'), width: 1200, height: 675, note: 'summary_large_image card, 16:9.' },
  { id: 'linkedin', label: t('LinkedIn shared link'), width: 1200, height: 627, note: 'Link and article preview image.' },
  { id: 'insta-square', label: t('Instagram square post'), width: 1080, height: 1080, note: '1:1 feed post.' },
  { id: 'insta-portrait', label: t('Instagram portrait post'), width: 1080, height: 1350, note: '4:5 feed post (takes the most screen space).' },
  { id: 'story', label: t('Story / Reel (vertical)'), width: 1080, height: 1920, note: '9:16 full-screen story. Keep text away from the top and bottom 250 px.' },
  { id: 'youtube-thumb', label: t('YouTube thumbnail'), width: 1280, height: 720, note: '16:9 video thumbnail (max 2 MB).' },
  { id: 'pinterest', label: t('Pinterest pin'), width: 1000, height: 1500, note: '2:3 standard pin.' },
  { id: 'facebook-cover', label: t('Facebook cover'), width: 1640, height: 624, note: 'Page cover photo. Mobile crops the sides.' },
];
