#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Юнит-тесты парсера commands.py (v3.0).

Семантика v3.0:
  - parse(): для admin/superadmin почти всё → unknown (уходит в LLM),
    для user — команды просмотра/закрытия + help/registry_link.
  - parse_canonical(): полный набор команд без проверки роли
    (используется для LLM-интерпретаций после подтверждения «да»).

Тесты без сети и Google.
"""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import commands

USER = {"role": "user", "today": date(2026, 8, 13)}          # четверг
ADMIN = {"role": "admin", "today": date(2026, 8, 13)}
SUPER = {"role": "superadmin", "today": date(2026, 8, 13)}
TODAY = date(2026, 8, 13)


def parse(text, **kw):
    return commands.parse(text, **kw)


def canon(text):
    return commands.parse_canonical(text, today=TODAY)


# ======== СПРАВКА И МАРШРУТИЗАЦИЯ ========

class TestHelpAndRouting(unittest.TestCase):

    def test_help_text_admin_free_form(self):
        text = commands.help_text("admin")
        self.assertIn("свободной форме", text)

    def test_help_text_superadmin_free_form(self):
        text = commands.help_text("superadmin")
        self.assertIn("свободной форме", text)

    def test_help_text_user_my_tasks(self):
        text = commands.help_text("user")
        self.assertIn("Мои поручения", text)

    def test_route_unrecognized_admin(self):
        self.assertEqual(commands.route_unrecognized("admin"), "llm")
        self.assertEqual(commands.route_unrecognized("superadmin"), "llm")

    def test_route_unrecognized_user(self):
        self.assertEqual(commands.route_unrecognized("user"), "fallback")

    def test_unknown_command_contains_help(self):
        c = commands.unknown_command("user")
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)
        self.assertIn("Мои поручения", c.error)


# ======== PARSE: ОБЫЧНЫЙ ПОЛЬЗОВАТЕЛЬ ========

class TestParseUser(unittest.TestCase):

    def test_help_variants(self):
        for t in ("помощь", "справка", "команды", "help", "/start", "/help", "старт"):
            c = parse(t, **USER)
            self.assertTrue(c.ok, t)
            self.assertEqual(c.name, "help", t)

    def test_registry_link(self):
        c = parse("реестр", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "registry_link")

    def test_list_my(self):
        c = parse("мои поручения", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_my")

    def test_list_all(self):
        for t in ("все поручения", "всё поручения"):
            c = parse(t, **USER)
            self.assertTrue(c.ok, t)
            self.assertEqual(c.name, "list_all", t)

    def test_list_status(self):
        c = parse("поручения статус В работе", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_status")
        self.assertEqual(c.args["status"], "В работе")

    def test_list_project(self):
        c = parse("поручения Ремонт офиса", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_project")
        self.assertEqual(c.args["project"], "Ремонт офиса")

    def test_close_with_hash(self):
        c = parse("закрыть #5", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "close")
        self.assertEqual(c.args["id"], 5)

    def test_close_without_hash(self):
        c = parse("закрыть 12", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "close")
        self.assertEqual(c.args["id"], 12)

    def test_case_and_spaces(self):
        c = parse("  Мои   Поручения ", **USER)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_my")

    def test_user_admin_commands_unknown(self):
        # В v3.0 у пользователя нет админских команд — они просто не распознаются
        for t in ("срок #1 завтра", "удалить #3", "дайджест",
                  "новый реестр Тест", "создать поручение: Проект=А"):
            c = parse(t, **USER)
            self.assertFalse(c.ok, t)
            self.assertIn("Не понял команду", c.error, t)

    def test_user_garbage(self):
        c = parse("абракадабра", **USER)
        self.assertFalse(c.ok)

    def test_empty(self):
        c = parse("   ", **USER)
        self.assertFalse(c.ok)


# ======== PARSE: АДМИН / СУПЕРАДМИН ========

class TestParseAdmin(unittest.TestCase):

    def test_admin_help_ok(self):
        c = parse("помощь", **ADMIN)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "help")

    def test_admin_registry_link_ok(self):
        c = parse("реестр", **ADMIN)
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "registry_link")

    def test_admin_everything_else_unknown(self):
        # v3.0: админу канонические команды отключены — всё уходит в LLM
        for t in ("мои поручения", "все поручения", "закрыть #5",
                  "срок #1 завтра", "удалить #3", "дайджест",
                  "поручения статус Новое"):
            c = parse(t, **ADMIN)
            self.assertFalse(c.ok, t)
            self.assertIn("Не понял команду", c.error, t)

    def test_superadmin_same_as_admin(self):
        for t in ("мои поручения", "закрыть #5", "лимиты 10 100"):
            c = parse(t, **SUPER)
            self.assertFalse(c.ok, t)

    def test_admin_unknown_error_has_free_form_hint(self):
        c = parse("мои поручения", **ADMIN)
        self.assertIn("свободной форме", c.error)


# ======== УМНЫЕ ДАТЫ ========

class TestNormalizeDate(unittest.TestCase):

    def n(self, text):
        return commands.normalize_date(text, TODAY)

    def test_today(self):
        self.assertEqual(self.n("сегодня"), "13.08.2026")

    def test_tomorrow(self):
        self.assertEqual(self.n("завтра"), "14.08.2026")

    def test_day_after_tomorrow(self):
        self.assertEqual(self.n("послезавтра"), "15.08.2026")

    def test_weekday_same_week(self):
        # 13.08.2026 — четверг; ближайшая пятница — 14.08
        self.assertEqual(self.n("в пятницу"), "14.08.2026")

    def test_weekday_next_week(self):
        # ближайший понедельник после четверга — 17.08
        self.assertEqual(self.n("в понедельник"), "17.08.2026")

    def test_numeric_full(self):
        self.assertEqual(self.n("20.08.2026"), "20.08.2026")

    def test_numeric_short_year(self):
        self.assertEqual(self.n("20.08.26"), "20.08.2026")

    def test_numeric_no_year_future(self):
        self.assertEqual(self.n("01.09"), "01.09.2026")

    def test_numeric_no_year_past_rolls_to_next_year(self):
        self.assertEqual(self.n("01.01"), "01.01.2027")

    def test_invalid_date(self):
        self.assertIsNone(self.n("32.13.2026"))

    def test_garbage(self):
        self.assertIsNone(self.n("когда-нибудь"))


# ======== PARSE_CANONICAL: ПОЛНЫЙ НАБОР (для LLM) ========

class TestParseCanonical(unittest.TestCase):

    def test_help(self):
        c = canon("помощь")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "help")

    def test_registry_link(self):
        c = canon("реестр")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "registry_link")

    def test_list_commands(self):
        self.assertEqual(canon("мои поручения").name, "list_my")
        self.assertEqual(canon("все поручения").name, "list_all")
        c = canon("поручения статус Новое")
        self.assertEqual((c.name, c.args["status"]), ("list_status", "Новое"))
        c = canon("поручения Проект Альфа")
        self.assertEqual((c.name, c.args["project"]), ("list_project", "Проект Альфа"))

    def test_close(self):
        c = canon("закрыть #7")
        self.assertEqual((c.ok, c.name, c.args["id"]), (True, "close", 7))

    def test_digest(self):
        c = canon("дайджест")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "digest")

    def test_new_registry(self):
        c = canon("новый реестр Бэклог 2027")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "new_registry")
        self.assertEqual(c.args["title"], "Бэклог 2027")

    def test_switch_registry(self):
        c = canon("переключить реестр на Основной")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "switch_registry")
        self.assertEqual(c.args["name"], "Основной")

    def test_deadline_smart_date(self):
        c = canon("срок #3 завтра")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "deadline")
        self.assertEqual(c.args["id"], 3)
        self.assertEqual(c.args["date"], "14.08.2026")

    def test_deadline_numeric_date(self):
        c = canon("срок #3 01.09.2026")
        self.assertTrue(c.ok)
        self.assertEqual(c.args["date"], "01.09.2026")

    def test_deadline_bad_date(self):
        c = canon("срок #3 когда-нибудь")
        self.assertFalse(c.ok)
        self.assertIn("дату", c.error.lower())

    def test_status(self):
        c = canon("статус #4 В работе")
        self.assertEqual((c.ok, c.name, c.args["id"], c.args["status"]),
                         (True, "status", 4, "В работе"))

    def test_assignee(self):
        c = canon("ответственный #4 Иванов")
        self.assertEqual((c.ok, c.name, c.args["assignee"]),
                         (True, "assignee", "Иванов"))

    def test_description(self):
        c = canon("описание #4 Новый текст")
        self.assertEqual((c.ok, c.name, c.args["description"]),
                         (True, "description", "Новый текст"))

    def test_comment(self):
        c = canon("комментарий #4 Уточнить сроки")
        self.assertEqual((c.ok, c.name, c.args["comment"]),
                         (True, "comment", "Уточнить сроки"))

    def test_delete(self):
        c = canon("удалить #9")
        self.assertEqual((c.ok, c.name, c.args["id"]), (True, "delete", 9))

    def test_create_full(self):
        c = canon("создать поручение: Проект=Альфа; Описание=Сделать X; "
                  "Ответственный=Иванов; Срок=завтра")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "create")
        self.assertEqual(c.args["project"], "Альфа")
        self.assertEqual(c.args["description"], "Сделать X")
        self.assertEqual(c.args["assignee"], "Иванов")
        self.assertEqual(c.args["deadline"], "14.08.2026")

    def test_create_missing_field(self):
        c = canon("создать поручение: Проект=Альфа; Описание=Сделать X")
        self.assertFalse(c.ok)

    def test_create_bad_date(self):
        c = canon("создать поручение: Проект=А; Описание=Б; "
                  "Ответственный=В; Срок=когда-нибудь")
        self.assertFalse(c.ok)

    def test_unrecognized(self):
        c = canon("погладить кота")
        self.assertFalse(c.ok)

    def test_empty(self):
        c = canon("   ")
        self.assertFalse(c.ok)


if __name__ == '__main__':
    unittest.main(verbosity=2)
