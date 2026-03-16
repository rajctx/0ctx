import type Database from 'better-sqlite3';
import type {
    ContextEdge,
    ContextNode,
    SearchAdvancedOptions,
    SearchMatchReason,
    SearchResult
} from '../schema';
import {
    buildFtsQuery,
    escapeRegex,
    parseNodeRow,
    tokenizeQuery
} from './helpers';

export { buildFtsQuery, escapeRegex, tokenizeQuery } from './helpers';

export function searchAdvancedRecords(
    db: Database.Database,
    contextId: string,
    query: string,
    options: SearchAdvancedOptions = {}
): SearchResult[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
    const sinceMs = Math.max(1, Math.floor(options.sinceMs ?? 24 * 60 * 60 * 1000));
    const includeSuperseded = options.includeSuperseded ?? false;
    const includeHidden = options.includeHidden ?? false;
    const now = Date.now();
    const queryTerms = tokenizeQuery(normalizedQuery);
    const ftsQuery = buildFtsQuery(normalizedQuery);
    const hiddenFilterSql = includeHidden ? '' : ' AND n.hidden = 0';

    let rows: any[] = [];
    try {
        rows = db.prepare(`
          SELECT n.*, bm25(nodes_fts, 5.0, 1.5) AS bm25Rank
          FROM nodes n
          JOIN nodes_fts ON n.id = nodes_fts.id
          WHERE n.contextId = ? ${hiddenFilterSql} AND nodes_fts MATCH ?
          ORDER BY bm25Rank ASC
          LIMIT ?
        `).all(contextId, ftsQuery, Math.max(limit * 5, limit)) as any[];
    } catch {
        rows = includeHidden
            ? db.prepare(`
              SELECT * FROM nodes
              WHERE contextId = ?
                AND (content LIKE ? OR tags LIKE ?)
              ORDER BY createdAt DESC
              LIMIT ?
            `).all(contextId, `%${normalizedQuery}%`, `%${normalizedQuery}%`, Math.max(limit * 5, limit)) as any[]
            : db.prepare(`
              SELECT * FROM nodes
              WHERE contextId = ?
                AND hidden = 0
                AND (content LIKE ? OR tags LIKE ?)
              ORDER BY createdAt DESC
              LIMIT ?
            `).all(contextId, `%${normalizedQuery}%`, `%${normalizedQuery}%`, Math.max(limit * 5, limit)) as any[];
    }

    const supersededRows = db.prepare(`
      SELECT DISTINCT e.toId AS id
      FROM edges e
      JOIN nodes n ON n.id = e.toId
      WHERE n.contextId = ? AND e.relation = 'supersedes'
    `).all(contextId) as Array<{ id: string }>;
    const supersededNodeIds = new Set(supersededRows.map((row) => row.id));

    const candidateIds = rows
        .map((row) => (typeof row.id === 'string' ? row.id : ''))
        .filter((id): id is string => id.length > 0);
    const degreeByNode = new Map<string, number>();
    if (candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => '?').join(', ');
        const degreeRows = db.prepare(`
          SELECT nodeId, SUM(cnt) AS degree FROM (
            SELECT fromId AS nodeId, COUNT(*) AS cnt
            FROM edges
            WHERE fromId IN (${placeholders})
            GROUP BY fromId
            UNION ALL
            SELECT toId AS nodeId, COUNT(*) AS cnt
            FROM edges
            WHERE toId IN (${placeholders})
            GROUP BY toId
          )
          GROUP BY nodeId
        `).all(...candidateIds, ...candidateIds) as Array<{ nodeId: string; degree: number }>;
        for (const row of degreeRows) {
            degreeByNode.set(row.nodeId, row.degree ?? 0);
        }
    }

    const results: SearchResult[] = [];
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const node: ContextNode = parseNodeRow(row);
        const isSuperseded = supersededNodeIds.has(node.id);
        if (!includeSuperseded && isSuperseded) continue;

        const tagsLower = (node.tags ?? []).map((tag) => tag.toLowerCase());
        const contentLower = node.content.toLowerCase();
        const matchedTerms = queryTerms.filter(
            (term) => contentLower.includes(term) || tagsLower.some((tag) => tag.includes(term))
        );
        const exactTermMatches = queryTerms.filter((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(node.content));
        const exactPhraseMatch = normalizedQuery.length >= 3 && contentLower.includes(normalizedQuery.toLowerCase());
        const tagMatch = queryTerms.some((term) => tagsLower.some((tag) => tag.includes(term)));
        const tagTermMatches = queryTerms.filter((term) => tagsLower.some((tag) => tag.includes(term))).length;
        const recentMutation = (now - node.createdAt) <= sinceMs;
        const degree = degreeByNode.get(node.id) ?? 0;
        const connectedToHotNode = degree >= 3;

        let matchReason: SearchMatchReason = 'exact_term';
        if (!exactPhraseMatch && exactTermMatches.length === 0) {
            if (tagMatch) matchReason = 'tag_match';
            else if (recentMutation) matchReason = 'recent_mutation';
            else if (connectedToHotNode) matchReason = 'connected_to_hot_node';
        }

        const rankScore = Math.max(0, 110 - (index * 4));
        const bm25Rank = typeof row.bm25Rank === 'number' ? row.bm25Rank : null;
        let bm25Score = 0;
        if (bm25Rank !== null) {
            bm25Score = bm25Rank < 0 ? 30 : Math.max(0, 30 - (bm25Rank * 12));
        }

        let score = rankScore + bm25Score + (matchedTerms.length * 5) + (exactTermMatches.length * 4);
        if (exactPhraseMatch) score += 12;
        if (tagMatch) score += 5 + Math.min(9, tagTermMatches * 3);
        if (recentMutation) score += 4;
        if (connectedToHotNode) score += 3;
        if (isSuperseded) score -= 45;

        results.push({
            node,
            score: Math.max(0, Number(score.toFixed(2))),
            matchReason,
            matchedTerms
        });
    }

    results.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.node.createdAt - a.node.createdAt));
    return results.slice(0, limit);
}

export function searchRecords(
    db: Database.Database,
    contextId: string,
    query: string,
    limit = 20,
    options: { includeHidden?: boolean } = {}
): ContextNode[] {
    return searchAdvancedRecords(db, contextId, query, {
        limit,
        includeSuperseded: true,
        includeHidden: options.includeHidden ?? false
    }).map((result) => result.node);
}

export function getGraphDataRecords(
    db: Database.Database,
    contextId: string,
    options: { includeHidden?: boolean } = {}
): { nodes: ContextNode[]; edges: ContextEdge[] } {
    const includeHidden = options.includeHidden ?? false;
    const nodeRows = includeHidden
        ? db.prepare('SELECT * FROM nodes WHERE contextId = ? ORDER BY createdAt DESC').all(contextId) as any[]
        : db.prepare('SELECT * FROM nodes WHERE contextId = ? AND hidden = 0 ORDER BY createdAt DESC').all(contextId) as any[];
    const edgeRows = includeHidden
        ? db.prepare(`
          SELECT e.*
          FROM edges e
          JOIN nodes nf ON e.fromId = nf.id
          JOIN nodes nt ON e.toId = nt.id
          WHERE nf.contextId = ? AND nt.contextId = ?
        `).all(contextId, contextId) as ContextEdge[]
        : db.prepare(`
          SELECT e.*
          FROM edges e
          JOIN nodes nf ON e.fromId = nf.id
          JOIN nodes nt ON e.toId = nt.id
          WHERE nf.contextId = ? AND nt.contextId = ? AND nf.hidden = 0 AND nt.hidden = 0
        `).all(contextId, contextId) as ContextEdge[];

    return {
        nodes: nodeRows.map((row) => parseNodeRow(row)),
        edges: edgeRows
    };
}
