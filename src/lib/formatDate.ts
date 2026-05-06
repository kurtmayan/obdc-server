import { format } from 'date-fns';

export function parseDateTime(date: Date) {
  return {
    date: format(date, 'MM/dd/yyyy'),
    time: format(date, 'hh:mm:ss'),
  };
}

export function exportParseDateTime(date: Date) {
  const iso = date.toISOString();
  // Extract date (YYYY-MM-DD) and time (HH:mm:ss) from ISO string
  const [datePart, timePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');
  const time = timePart.substring(0, 8); // HH:mm:ss

  return {
    date: `${month}/${day}/${year}`,
    time,
  };
}
