#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Клиент Supabase REST (PostgREST) для BL-36. Service key, без SDK.

config: supabase.json {"url": ..., "service_key": ...}
"""

import requests

import config

_session = requests.Session()
_cfg = None


def _init():
    global _cfg
    if _cfg is None:
        _cfg = config.load_supabase_config()
    if not _cfg:
        raise RuntimeError('supabase.json не найден или неполон (.credentials/)')
    return _cfg


def _headers(prefer=None):
    cfg = _init()
    h = {
        'apikey': cfg['service_key'],
        'Authorization': 'Bearer %s' % cfg['service_key'],
        'Content-Type': 'application/json',
    }
    if prefer:
        h['Prefer'] = prefer
    return h


def _url(table):
    return '%s/rest/v1/%s' % (_init()['url'].rstrip('/'), table)


def insert(table, row):
    """Вставка строки, возвращает созданную запись (или None при ошибке)."""
    r = _session.post(_url(table), headers=_headers('return=representation'),
                      json=row, timeout=30)
    if r.status_code not in (200, 201):
        print('db.insert %s -> %s: %s' % (table, r.status_code, r.text[:300]),
              flush=True)
        return None
    data = r.json()
    return data[0] if isinstance(data, list) and data else data


def upsert(table, row, on_conflict):
    """Upsert по уникальному ключу (напр. on_conflict='chat_id,msg_id')."""
    r = _session.post(
        _url(table) + ('?on_conflict=%s' % on_conflict),
        headers=_headers('return=representation,resolution=merge-duplicates'),
        json=row, timeout=30)
    if r.status_code not in (200, 201):
        print('db.upsert %s -> %s: %s' % (table, r.status_code, r.text[:300]),
              flush=True)
        return None
    data = r.json()
    return data[0] if isinstance(data, list) and data else data


def select(table, params=None):
    """SELECT с query-параметрами PostgREST, возвращает list[dict]."""
    r = _session.get(_url(table), headers=_headers(), params=params or {},
                     timeout=30)
    if r.status_code != 200:
        print('db.select %s -> %s: %s' % (table, r.status_code, r.text[:300]),
              flush=True)
        return []
    return r.json()


def update(table, match_params, patch, check_rows=False):
    """UPDATE по фильтру (напр. {'id': 'eq.<uuid>'}).

    check_rows=True — вернуть True только если затронута хотя бы одна строка
    (атомарные захваты вида WHERE status='pending').
    """
    prefer = 'return=representation' if check_rows else None
    r = _session.patch(_url(table), headers=_headers(prefer),
                       params=match_params, json=patch, timeout=30)
    if r.status_code not in (200, 204):
        print('db.update %s -> %s: %s' % (table, r.status_code, r.text[:300]),
              flush=True)
        return False
    if check_rows:
        try:
            return bool(r.json())
        except Exception:
            return False
    return True


def count_pending_proposals():
    rows = select('bl36_proposals', {'status': 'eq.pending', 'select': 'id'})
    return len(rows)
