import { getLogsUiMarkup } from './logs-ui/markup';
import { LOGS_UI_SCRIPT_PRIMARY } from './logs-ui/script-primary';
import { LOGS_UI_SCRIPT_SECONDARY } from './logs-ui/script-secondary';
import { LOGS_UI_STYLES_BASE } from './logs-ui/styles-base';
import { LOGS_UI_STYLES_DETAIL } from './logs-ui/styles-detail';

/**
 * Self-contained terminal-aesthetic HTML UI for `0ctx logs`.
 * Served by logs-server.ts over localhost. No external deps - pure HTML/CSS/JS.
 */
export function getLogsHtml(port: number): string {
    const script = `${LOGS_UI_SCRIPT_PRIMARY.replace('__PORT__', String(port))}\n${LOGS_UI_SCRIPT_SECONDARY}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>0CTX // LOCAL LOGS</title>
<style>
${LOGS_UI_STYLES_BASE}
${LOGS_UI_STYLES_DETAIL}
</style>
</head>
${getLogsUiMarkup(port)}
<script>
${script}
</script>
</body>
</html>`;
}
