import { createHashRouter } from 'react-router-dom';
import { RouteShell } from './route-shell';
import { OverviewScreen } from '../screens/overview/overview-screen';
import { WorkstreamsScreen } from '../screens/workstreams/workstreams-screen';
import { SessionsScreen } from '../screens/sessions/sessions-screen';
import { SetupScreen } from '../screens/setup/setup-screen';

export const desktopRouter = createHashRouter([
  {
    path: '/',
    element: <RouteShell />,
    children: [
      { index: true, element: <OverviewScreen /> },
      { path: 'overview', element: <OverviewScreen /> },
      { path: 'workstreams', element: <WorkstreamsScreen /> },
      { path: 'sessions', element: <SessionsScreen /> },
      { path: 'setup', element: <SetupScreen /> }
    ]
  }
]);
