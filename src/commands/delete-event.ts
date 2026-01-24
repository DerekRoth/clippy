import { Command } from 'commander';
import { resolveAuth } from '../lib/auth.js';
import { getCalendarEvents, deleteEvent } from '../lib/owa-client.js';

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function parseDay(day: string): Date {
  const now = new Date();

  switch (day.toLowerCase()) {
    case 'today':
      return now;
    case 'tomorrow':
      now.setDate(now.getDate() + 1);
      return now;
    case 'yesterday':
      now.setDate(now.getDate() - 1);
      return now;
    default:
      const parsed = new Date(day);
      return isNaN(parsed.getTime()) ? now : parsed;
  }
}

export const deleteEventCommand = new Command('delete-event')
  .description('Delete a calendar event')
  .argument('[eventIndex]', 'Event index from the list (1-based)')
  .option('--day <day>', 'Day to show events from (today, tomorrow, YYYY-MM-DD)', 'today')
  .option('--search <text>', 'Search for events by title')
  .option('--json', 'Output as JSON')
  .option('--token <token>', 'Use a specific token')
  .option('-i, --interactive', 'Open browser to extract token automatically')
  .action(async (eventIndex: string | undefined, options: {
    day: string;
    search?: string;
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

    // Get events for the day
    const baseDate = parseDay(options.day);
    const startOfDay = new Date(baseDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(baseDate);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await getCalendarEvents(
      authResult.token!,
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );

    if (!result.ok || !result.data) {
      if (options.json) {
        console.log(JSON.stringify({ error: result.error?.message || 'Failed to fetch events' }, null, 2));
      } else {
        console.error(`Error: ${result.error?.message || 'Failed to fetch events'}`);
      }
      process.exit(1);
    }

    // Filter to events the user owns (IsOrganizer) and optionally by search
    let events = result.data.filter(e => e.IsOrganizer && !e.IsCancelled);

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      events = events.filter(e => e.Subject?.toLowerCase().includes(searchLower));
    }

    // If no index provided, list events
    if (!eventIndex) {
      if (options.json) {
        console.log(JSON.stringify({
          events: events.map((e, i) => ({
            index: i + 1,
            id: e.Id,
            subject: e.Subject,
            start: e.Start.DateTime,
            end: e.End.DateTime,
          })),
        }, null, 2));
        return;
      }

      console.log(`\nYour events for ${formatDate(baseDate.toISOString())}:\n`);
      console.log('\u2500'.repeat(60));

      if (events.length === 0) {
        console.log('\n  No events found that you can delete.');
        console.log('  (You can only delete events you organized)\n');
        return;
      }

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const startTime = formatTime(event.Start.DateTime);
        const endTime = formatTime(event.End.DateTime);

        console.log(`\n  [${i + 1}] ${event.Subject}`);
        console.log(`      ${startTime} - ${endTime}`);
        if (event.Location?.DisplayName) {
          console.log(`      Location: ${event.Location.DisplayName}`);
        }
      }

      console.log('\n' + '\u2500'.repeat(60));
      console.log('\nTo delete an event:');
      console.log('  clippy delete-event <number>');
      console.log('  clippy delete-event <number> --day tomorrow');
      console.log('');
      return;
    }

    // Delete the specified event
    const idx = parseInt(eventIndex) - 1;
    if (isNaN(idx) || idx < 0 || idx >= events.length) {
      console.error(`Invalid event number: ${eventIndex}`);
      console.error(`Valid range: 1-${events.length}`);
      process.exit(1);
    }

    const targetEvent = events[idx];

    console.log(`\nDeleting: ${targetEvent.Subject}`);
    console.log(`  ${formatDate(targetEvent.Start.DateTime)} ${formatTime(targetEvent.Start.DateTime)} - ${formatTime(targetEvent.End.DateTime)}`);

    const deleteResult = await deleteEvent(authResult.token!, targetEvent.Id);

    if (!deleteResult.ok) {
      if (options.json) {
        console.log(JSON.stringify({ error: deleteResult.error?.message || 'Failed to delete event' }, null, 2));
      } else {
        console.error(`\nError: ${deleteResult.error?.message || 'Failed to delete event'}`);
      }
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify({ success: true, deleted: targetEvent.Subject }, null, 2));
    } else {
      console.log('\n\u2713 Event deleted successfully.\n');
    }
  });
