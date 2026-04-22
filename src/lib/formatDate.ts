import { format } from 'date-fns';

export function parseDateTime(date: Date) {
  return {
    date: format(date, 'MM/dd/yyyy'),
    time: format(date, 'hh:mm:ss'),
  };
}

export function exportParseDateTime(date: Date) {
  return {
    date: format(date, 'MM/dd/yyyy'),
    time: format(date, 'HH:mm:ss'),
  };
}
