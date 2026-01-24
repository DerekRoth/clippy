import { Command } from 'commander';
import { resolveAuth } from '../lib/auth.js';
import { getFreeBusy, type FreeBusySlot } from '../lib/owa-client.js';

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'Free': return '🟢';
    case 'Tentative': return '🟡';
    case 'Busy': return '🔴';
    default: return '⚪';
  }
}

function getDateRange(day: string): { start: Date; end: Date } {
  const now = new Date();
  let targetDate: Date;

  switch (day.toLowerCase()) {
    case 'today':
      targetDate = now;
      break;
    case 'tomorrow':
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
      break;
    default:
      targetDate = new Date(day);
      if (isNaN(targetDate.getTime())) {
        targetDate = now;
      }
  }

  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(targetDate);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function findFreeSlots(
  slots: FreeBusySlot[],
  dayStart: Date,
  dayEnd: Date,
  workStart: number = 9,
  workEnd: number = 17
): { start: Date; end: Date }[] {
  // Set working hours
  const workingStart = new Date(dayStart);
  workingStart.setHours(workStart, 0, 0, 0);
  const workingEnd = new Date(dayStart);
  workingEnd.setHours(workEnd, 0, 0, 0);

  // Filter to busy slots only and sort
  const busySlots = slots
    .filter(s => s.status !== 'Free')
    .map(s => ({
      start: new Date(s.start),
      end: new Date(s.end),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const freeSlots: { start: Date; end: Date }[] = [];
  let current = workingStart;

  for (const busy of busySlots) {
    // Skip if busy slot is outside working hours
    if (busy.end <= workingStart || busy.start >= workingEnd) continue;

    // Clamp to working hours
    const busyStart = busy.start < workingStart ? workingStart : busy.start;
    const busyEnd = busy.end > workingEnd ? workingEnd : busy.end;

    if (busyStart > current) {
      freeSlots.push({ start: new Date(current), end: new Date(busyStart) });
    }
    current = busyEnd > current ? busyEnd : current;
  }

  // Add remaining time until end of working hours
  if (current < workingEnd) {
    freeSlots.push({ start: new Date(current), end: new Date(workingEnd) });
  }

  return freeSlots;
}

export const freebusyCommand = new Command('freebusy')
  .description('Check free/busy status')
  .argument('[day]', 'Day to check (today, tomorrow, or YYYY-MM-DD)', 'today')
  .option('--start <hour>', 'Work day start hour (0-23)', '9')
  .option('--end <hour>', 'Work day end hour (0-23)', '17')
  .option('--free', 'Show free slots instead of busy')
  .option('--json', 'Output as JSON')
  .option('--token <token>', 'Use a specific token')
  .option('-i, --interactive', 'Open browser to extract token automatically')
  .action(async (day: string, options: {
    start: string;
    end: string;
    free?: boolean;
    json?: boolean;
    token?: string;
    interactive?: boolean
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

    const { start, end } = getDateRange(day);
    const result = await getFreeBusy(authResult.token!, start.toISOString(), end.toISOString());

    if (!result.ok || !result.data) {
      if (options.json) {
        console.log(JSON.stringify({ error: result.error?.message || 'Failed to fetch schedule' }, null, 2));
      } else {
        console.error(`Error: ${result.error?.message || 'Failed to fetch schedule'}`);
      }
      process.exit(1);
    }

    const workStart = parseInt(options.start);
    const workEnd = parseInt(options.end);

    if (options.json) {
      if (options.free) {
        const freeSlots = findFreeSlots(result.data, start, end, workStart, workEnd);
        console.log(JSON.stringify(freeSlots.map(s => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })), null, 2));
      } else {
        console.log(JSON.stringify(result.data, null, 2));
      }
      return;
    }

    const dateLabel = formatDate(start.toISOString());
    console.log(`\n📊 ${options.free ? 'Free times' : 'Busy times'} for ${dateLabel}`);
    console.log('─'.repeat(40));

    if (options.free) {
      const freeSlots = findFreeSlots(result.data, start, end, workStart, workEnd);
      if (freeSlots.length === 0) {
        console.log('  No free time during working hours.');
      } else {
        for (const slot of freeSlots) {
          const duration = Math.round((slot.end.getTime() - slot.start.getTime()) / 60000);
          const hours = Math.floor(duration / 60);
          const mins = duration % 60;
          const durationStr = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
          console.log(`  🟢 ${formatTime(slot.start.toISOString())} - ${formatTime(slot.end.toISOString())} (${durationStr})`);
        }
      }
    } else {
      const busySlots = result.data.filter(s => s.status !== 'Free');
      if (busySlots.length === 0) {
        console.log('  🟢 All day free!');
      } else {
        for (const slot of busySlots) {
          const icon = getStatusIcon(slot.status);
          console.log(`  ${icon} ${formatTime(slot.start)} - ${formatTime(slot.end)}: ${slot.subject || slot.status}`);
        }
      }
    }
    console.log();
  });
