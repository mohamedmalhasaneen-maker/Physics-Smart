import {
  SyncEntityType,
  SyncQueueItem,
  getSyncQueueItems,
  putSyncQueueItem,
  removeSyncQueueItem,
} from './offlineDb';

export type SyncLifecycleState = 'online' | 'offline' | 'syncing' | 'synced' | 'error';

export interface SyncStatusSnapshot {
  state: SyncLifecycleState;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

type SyncListener = (status: SyncStatusSnapshot) => void;
const listeners = new Set<SyncListener>();

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

let currentStatus: SyncStatusSnapshot = {
  state: isBrowserOffline() ? 'offline' : 'online',
  pendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

let flushInFlight = false;

function emitStatus(patch: Partial<SyncStatusSnapshot>) {
  currentStatus = { ...currentStatus, ...patch };
  listeners.forEach((cb) => {
    try {
      cb(currentStatus);
    } catch {
      // ignore listener errors
    }
  });
}

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
  return currentStatus;
}

export function subscribeSyncStatus(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(currentStatus);
  return () => {
    listeners.delete(listener);
  };
}

export function setOnlineSyncIndicator(isOnline: boolean) {
  emitStatus({
    state: isOnline ? (flushInFlight ? 'syncing' : 'online') : 'offline',
  });
}

export async function refreshPendingSyncCount(uid?: string): Promise<number> {
  const items = await getSyncQueueItems(uid);
  emitStatus({ pendingCount: items.length });
  return items.length;
}

/**
 * Deduplicated queue enqueue: preserves chronological creation time while updating
 * the latest payload for identical `(uid, entityType, entityId)` mutations.
 */
export async function enqueueSyncMutation(params: {
  uid: string;
  entityType: SyncEntityType;
  entityId: string;
  op: 'upsert' | 'delete';
  payload: any;
}): Promise<SyncQueueItem> {
  const existingAll = await getSyncQueueItems(params.uid);
  const existing = existingAll.find(
    (item) => item.entityType === params.entityType && item.entityId === params.entityId
  );

  let mergedPayload = params.payload;
  // Conflict-safe merge for repeated offline progress updates before sync
  if (existing && params.entityType === 'progress' && params.op === 'upsert') {
    const prevParts: string[] = Array.isArray(existing.payload?.completedParts) ? existing.payload.completedParts : [];
    const nextParts: string[] = Array.isArray(params.payload?.completedParts) ? params.payload.completedParts : [];
    mergedPayload = {
      ...existing.payload,
      ...params.payload,
      completedParts: Array.from(new Set([...prevParts, ...nextParts])),
      isCompleted: Boolean(existing.payload?.isCompleted || params.payload?.isCompleted),
      quizScore: Math.max(Number(existing.payload?.quizScore || 0), Number(params.payload?.quizScore || 0)),
      studyMinutes: Math.max(Number(existing.payload?.studyMinutes || 0), Number(params.payload?.studyMinutes || 0)),
    };
  } else if (existing && params.entityType === 'pointsAward' && params.op === 'upsert') {
    const prevPoints = Number(existing.payload?.addPoints || 0);
    const nextPoints = Number(params.payload?.addPoints || 0);
    const prevBadges: string[] = Array.isArray(existing.payload?.badges) ? existing.payload.badges : [];
    const nextBadge = params.payload?.badgeName ? [String(params.payload.badgeName)] : [];
    mergedPayload = {
      addPoints: prevPoints + nextPoints,
      badgeName: nextBadge[0] || existing.payload?.badgeName,
      badges: Array.from(new Set([...prevBadges, ...nextBadge])),
    };
  }

  const record: SyncQueueItem = {
    id: existing?.id || `sync::${params.uid}::${params.entityType}::${params.entityId}`,
    uid: params.uid,
    entityType: params.entityType,
    entityId: params.entityId,
    op: params.op,
    payload: mergedPayload,
    createdAtMs: existing?.createdAtMs || Date.now(),
    updatedAtMs: Date.now(),
    retryCount: 0,
  };

  await putSyncQueueItem(record);
  await refreshPendingSyncCount(params.uid);
  return record;
}

export type SyncMutationExecutor = (item: SyncQueueItem) => Promise<void>;

export async function flushSyncQueue(
  uid: string,
  executor: SyncMutationExecutor
): Promise<{ processed: number; failed: number; remaining: number }> {
  if (!uid || flushInFlight) {
    const items = uid ? await getSyncQueueItems(uid) : [];
    return { processed: 0, failed: 0, remaining: items.length };
  }

  if (isBrowserOffline()) {
    const items = await getSyncQueueItems(uid);
    emitStatus({ state: 'offline', pendingCount: items.length });
    return { processed: 0, failed: 0, remaining: items.length };
  }

  const queue = await getSyncQueueItems(uid);
  if (queue.length === 0) {
    emitStatus({ state: 'online', pendingCount: 0 });
    return { processed: 0, failed: 0, remaining: 0 };
  }

  flushInFlight = true;
  emitStatus({ state: 'syncing', pendingCount: queue.length, lastError: null });

  let processed = 0;
  let failed = 0;
  let lastErrorMsg: string | null = null;

  try {
    for (const item of queue) {
      if (isBrowserOffline()) {
        break;
      }
      try {
        await executor(item);
        await removeSyncQueueItem(item.id);
        processed++;
      } catch (err: any) {
        failed++;
        lastErrorMsg = String(err?.message || 'Sync failed');
        await putSyncQueueItem({
          ...item,
          retryCount: (item.retryCount || 0) + 1,
          lastError: lastErrorMsg,
          updatedAtMs: Date.now(),
        });
      }
    }
  } finally {
    flushInFlight = false;
  }

  const remainingList = await getSyncQueueItems(uid);
  const onlineNow = !isBrowserOffline();
  emitStatus({
    state: !onlineNow ? 'offline' : failed > 0 ? 'error' : processed > 0 ? 'synced' : 'online',
    pendingCount: remainingList.length,
    lastSyncedAt: processed > 0 ? Date.now() : currentStatus.lastSyncedAt,
    lastError: lastErrorMsg,
  });

  return {
    processed,
    failed,
    remaining: remainingList.length,
  };
}
