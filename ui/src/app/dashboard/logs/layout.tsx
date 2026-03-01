import './logs.css';
import { LogShell } from '@/components/logs/log-shell';

export default function LogsLayout({ children }: { children: React.ReactNode }) {
  return <LogShell>{children}</LogShell>;
}
