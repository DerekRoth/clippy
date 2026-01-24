import { Command } from 'commander';
import { resolveAuth } from '../lib/auth.js';
import { sendEmail } from '../lib/owa-client.js';
import { markdownToHtml } from '../lib/markdown.js';

export const sendCommand = new Command('send')
  .description('Send an email')
  .requiredOption('--to <emails>', 'Recipient email(s), comma-separated')
  .requiredOption('--subject <text>', 'Email subject')
  .requiredOption('--body <text>', 'Email body')
  .option('--cc <emails>', 'CC recipient(s), comma-separated')
  .option('--bcc <emails>', 'BCC recipient(s), comma-separated')
  .option('--html', 'Send body as HTML')
  .option('--markdown', 'Parse body as markdown (bold, links, lists)')
  .option('--json', 'Output as JSON')
  .option('--token <token>', 'Use a specific token')
  .option('-i, --interactive', 'Open browser to extract token automatically')
  .action(async (options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    html?: boolean;
    markdown?: boolean;
    json?: boolean;
    token?: string;
    interactive?: boolean;
  }) => {
    const authResult = await resolveAuth({
      token: options.token,
      interactive: options.interactive,
    });

    if (!authResult.success) {
      if (options.json) {
        console.log(JSON.stringify({ error: authResult.error }, null, 2));
      } else {
        console.error(`Error: ${authResult.error}`);
        console.error('\nRun `clippy login --interactive` to authenticate.');
      }
      process.exit(1);
    }

    const toList = options.to.split(',').map(e => e.trim()).filter(Boolean);
    const ccList = options.cc ? options.cc.split(',').map(e => e.trim()).filter(Boolean) : undefined;
    const bccList = options.bcc ? options.bcc.split(',').map(e => e.trim()).filter(Boolean) : undefined;

    if (toList.length === 0) {
      console.error('At least one recipient is required.');
      process.exit(1);
    }

    let body = options.body;
    let bodyType: 'Text' | 'HTML' = 'Text';

    if (options.markdown) {
      body = markdownToHtml(options.body);
      bodyType = 'HTML';
    } else if (options.html) {
      bodyType = 'HTML';
    }

    const result = await sendEmail(authResult.token!, {
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: options.subject,
      body,
      bodyType,
    });

    if (!result.ok) {
      if (options.json) {
        console.log(JSON.stringify({ error: result.error?.message || 'Failed to send email' }, null, 2));
      } else {
        console.error(`Error: ${result.error?.message || 'Failed to send email'}`);
      }
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify({ success: true, to: toList, subject: options.subject }, null, 2));
    } else {
      console.log(`\n\u2713 Email sent to ${toList.join(', ')}`);
      console.log(`  Subject: ${options.subject}\n`);
    }
  });
