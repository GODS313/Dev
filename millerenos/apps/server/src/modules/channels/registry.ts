/**
 * Messaging-platform connectors. Status reflects reality today — never advertise a connector
 * that is not OFFICIAL_SUPPORTED or LIMITED_SUPPORTED as available. See docs/INTEGRATIONS.md.
 */
export type IntegrationStatus = 'OFFICIAL_SUPPORTED' | 'LIMITED_SUPPORTED' | 'EXPERIMENTAL' | 'UNAVAILABLE';

export interface ChannelConnectorInfo {
  platform: string;
  status: IntegrationStatus;
  implemented: boolean;
  flag: string | null;
  method: string;
  notes: string;
}

export interface ChannelConnector {
  readonly info: ChannelConnectorInfo;
  sendMessage(externalChatId: string, text: string): Promise<void>;
}

export const CHANNELS: ChannelConnectorInfo[] = [
  {
    platform: 'telegram',
    status: 'OFFICIAL_SUPPORTED',
    implemented: true,
    flag: null,
    method: 'Telegram Bot API + Mini Apps (official)',
    notes: 'Millerenos bot and storefront Mini App. Merchant-owned bots are Phase 2.',
  },
  {
    platform: 'bale',
    status: 'UNAVAILABLE',
    implemented: false,
    flag: 'channels.bale',
    method: 'Bale Bot API (official, Telegram-compatible) — to be evaluated',
    notes: 'Not implemented. Requires review of Bale terms and API stability before enabling.',
  },
  {
    platform: 'eitaa',
    status: 'UNAVAILABLE',
    implemented: false,
    flag: null,
    method: 'Eitaayar API (limited, channel posting only) — to be evaluated',
    notes: 'Not implemented. Two-way messaging for merchants not confirmed as officially supported.',
  },
  {
    platform: 'rubika',
    status: 'UNAVAILABLE',
    implemented: false,
    flag: null,
    method: 'Rubika bot API — to be evaluated',
    notes: 'Not implemented. Official documentation and terms must be reviewed first.',
  },
  {
    platform: 'soroush_plus',
    status: 'UNAVAILABLE',
    implemented: false,
    flag: null,
    method: 'Unknown',
    notes: 'Not implemented. No confirmed official bot API reviewed yet.',
  },
  {
    platform: 'whatsapp',
    status: 'UNAVAILABLE',
    implemented: false,
    flag: 'channels.whatsapp',
    method: 'WhatsApp Business Platform (Cloud API) via Meta — requires business verification',
    notes: 'Not implemented. Only the official Cloud API will be used; unofficial clients are never used.',
  },
];
