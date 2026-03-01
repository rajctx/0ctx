import { redirect } from 'next/navigation';

export default function LogsIndexPage() {
  redirect('/dashboard/logs/activity');
}
