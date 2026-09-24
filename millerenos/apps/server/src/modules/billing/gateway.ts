/**
 * The subset of Telegram Bot API calls the platform needs, behind an interface so business
 * logic is testable without network access. Implemented with grammY in bot/gateway.ts.
 */
export interface TelegramGateway {
  readonly configured: boolean;
  sendMessage(chatId: string, text: string, opts?: { buttons?: { text: string; url?: string; webAppUrl?: string }[][] }): Promise<void>;
  createStarsInvoiceLink(input: { title: string; description: string; payload: string; amount: number; label: string }): Promise<string>;
  refundStarPayment(userTelegramId: string, chargeId: string): Promise<void>;
}

export class NullGateway implements TelegramGateway {
  readonly configured = false;
  async sendMessage() {}
  async createStarsInvoiceLink(): Promise<string> {
    throw new Error('Telegram bot is not configured');
  }
  async refundStarPayment() {
    throw new Error('Telegram bot is not configured');
  }
}
