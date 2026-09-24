import type { Api } from 'grammy';
import type { TelegramGateway } from '../modules/billing/gateway.js';

export class GrammyGateway implements TelegramGateway {
  readonly configured = true;
  constructor(private api: Api) {}

  async sendMessage(chatId: string, text: string, opts: { buttons?: { text: string; url?: string; webAppUrl?: string }[][] } = {}) {
    const keyboard = opts.buttons?.map((row) =>
      row.map((b) => (b.webAppUrl ? { text: b.text, web_app: { url: b.webAppUrl } } : { text: b.text, url: b.url! })),
    );
    await this.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  async createStarsInvoiceLink(input: { title: string; description: string; payload: string; amount: number; label: string }) {
    // Digital goods inside Telegram: currency XTR (Telegram Stars) with an empty provider token.
    return this.api.createInvoiceLink(input.title.slice(0, 32), input.description.slice(0, 255), input.payload, '', 'XTR', [
      { label: input.label.slice(0, 32), amount: input.amount },
    ]);
  }

  async refundStarPayment(userTelegramId: string, chargeId: string) {
    await this.api.refundStarPayment(Number(userTelegramId), chargeId);
  }
}
