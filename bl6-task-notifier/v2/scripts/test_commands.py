#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Юнит-тесты парсера команд commands.py (BL-6, v2.0).

Запуск:  python test_commands.py
"""

import sys
import os
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import commands  # noqa: E402

# Фиксированная «сегодняшняя» дата для детерминированных тестов:
# 12.08.2026 — среда (weekday()==2)
TODAY = date(2026, 8, 12)


def parse(text, role="user", chat_type="group"):
    return commands.parse(text, role=role, chat_type=chat_type, today=TODAY)


# ======== УМНЫЕ ДАТЫ ========

class TestDates(unittest.TestCase):
    def test_tomorrow(self):
        self.assertEqual(commands.normalize_date("завтра", TODAY), "13.08.2026")

    def test_day_after_tomorrow(self):
        self.assertEqual(commands.normalize_date("послезавтра", TODAY), "14.08.2026")

    def test_today(self):
        self.assertEqual(commands.normalize_date("сегодня", TODAY), "12.08.2026")

    def test_weekday_friday(self):
        # Среда -> ближайшая пятница = 14.08.2026
        self.assertEqual(commands.normalize_date("в пятницу", TODAY), "14.08.2026")

    def test_weekday_same_day(self):
        friday = date(2026, 8, 14)  # пятница
        self.assertEqual(commands.normalize_date("в пятницу", friday), "14.08.2026")

    def test_weekday_monday_next_week(self):
        # Среда -> понедельник уже прошёл, берём следующий = 17.08.2026
        self.assertEqual(commands.normalize_date("в понедельник", TODAY), "17.08.2026")

    def test_weekday_vo_variant(self):
        # Среда -> во вторник = 18.08.2026
        self.assertEqual(commands.normalize_date("во вторник", TODAY), "18.08.2026")

    def test_numeric_full(self):
        self.assertEqual(commands.normalize_date("20.08.2026", TODAY), "20.08.2026")

    def test_numeric_short_year(self):
        self.assertEqual(commands.normalize_date("20.08.26", TODAY), "20.08.2026")

    def test_numeric_no_year_future(self):
        self.assertEqual(commands.normalize_date("20.08", TODAY), "20.08.2026")

    def test_numeric_no_year_past_rolls_to_next_year(self):
        # 01.01 уже прошло относительно 12.08.2026 -> 01.01.2027
        self.assertEqual(commands.normalize_date("01.01", TODAY), "01.01.2027")

    def test_numeric_invalid(self):
        self.assertIsNone(commands.normalize_date("32.13.2026", TODAY))
        self.assertIsNone(commands.normalize_date("29.02.2026", TODAY))

    def test_garbage(self):
        self.assertIsNone(commands.normalize_date("когда-нибудь", TODAY))


# ======== ГРУППОВЫЕ КОМАНДЫ ========

class TestGroupCommands(unittest.TestCase):
    def test_list_my(self):
        c = parse("мои поручения")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_my")

    def test_list_my_case_and_spaces(self):
        c = parse("  МОИ   ПОРУЧЕНИЯ ")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_my")

    def test_list_all(self):
        c = parse("все поручения")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_all")

    def test_list_project(self):
        c = parse("поручения БЛ-6 Автоматизация")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_project")
        self.assertEqual(c.args["project"], "БЛ-6 Автоматизация")

    def test_list_status(self):
        c = parse("поручения статус В работе")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "list_status")
        self.assertEqual(c.args["status"], "В работе")

    def test_close(self):
        c = parse("закрыть #12")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "close")
        self.assertEqual(c.args["id"], 12)

    def test_close_no_hash(self):
        c = parse("закрыть 12")
        self.assertTrue(c.ok)
        self.assertEqual(c.args["id"], 12)

    def test_close_no_space(self):
        c = parse("закрыть#7")
        self.assertTrue(c.ok)
        self.assertEqual(c.args["id"], 7)

    def test_close_bad_id(self):
        c = parse("закрыть #abc")
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)


# ======== СОЗДАНИЕ ПОРУЧЕНИЯ ========

class TestCreate(unittest.TestCase):
    GOOD = ("создать поручение: Проект=BL-6; Описание=Починить дайджест; "
            "Ответственный=Иванова Т.; Срок=20.08.2026")

    def test_create_ok(self):
        c = parse(self.GOOD)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "create")
        self.assertEqual(c.args["project"], "BL-6")
        self.assertEqual(c.args["description"], "Починить дайджест")
        self.assertEqual(c.args["assignee"], "Иванова Т.")
        self.assertEqual(c.args["deadline"], "20.08.2026")

    def test_create_smart_date(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=в пятницу")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["deadline"], "14.08.2026")

    def test_create_case_insensitive_keys(self):
        c = parse("Создать поручение: ПРОЕКТ=BL-6; описание=Тест; "
                  "Ответственный=Иванов; СРОК=завтра")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["project"], "BL-6")
        self.assertEqual(c.args["deadline"], "13.08.2026")

    def test_create_missing_field(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; Срок=завтра")
        self.assertFalse(c.ok)
        self.assertIn("Ответственный", c.error)

    def test_create_empty_body(self):
        c = parse("создать поручение:")
        self.assertFalse(c.ok)
        self.assertIn("Укажите поля", c.error)

    def test_create_unknown_field(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=завтра; Приоритет=высокий")
        self.assertFalse(c.ok)
        self.assertIn("Неизвестное поле", c.error)

    def test_create_bad_date(self):
        c = parse("создать поручение: Проект=BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=когда-нибудь")
        self.assertFalse(c.ok)
        self.assertIn("Не понял дату", c.error)

    def test_create_no_separator(self):
        c = parse("создать поручение: Проект BL-6; Описание=Тест; "
                  "Ответственный=Иванов; Срок=завтра")
        self.assertFalse(c.ok)
        self.assertIn("Имя=Значение", c.error)


# ======== АДМИНСКИЕ КОМАНДЫ ========

class TestAdminCommands(unittest.TestCase):
    def test_deadline(self):
        c = parse("срок #12 20.08.2026", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "deadline")
        self.assertEqual(c.args["id"], 12)
        self.assertEqual(c.args["date"], "20.08.2026")

    def test_deadline_smart(self):
        c = parse("срок #12 завтра", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["date"], "13.08.2026")

    def test_deadline_bad_date(self):
        c = parse("срок #12 вчера", role="admin", chat_type="private")
        self.assertFalse(c.ok)
        self.assertIn("Не понял дату", c.error)

    def test_status(self):
        c = parse("статус #12 В работе", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "status")
        self.assertEqual(c.args["status"], "В работе")

    def test_assignee(self):
        c = parse("ответственный #12 Иванова Т.", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["assignee"], "Иванова Т.")

    def test_description(self):
        c = parse("описание #12 Новый текст поручения", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["description"], "Новый текст поручения")

    def test_comment(self):
        c = parse("комментарий #12 ждём ответ заказчика", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["comment"], "ждём ответ заказчика")

    def test_delete(self):
        c = parse("удалить #12", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "delete")
        self.assertEqual(c.args["id"], 12)

    def test_digest(self):
        c = parse("дайджест", role="admin", chat_type="private")
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "digest")

    def test_admin_command_denied_in_group(self):
        c = parse("срок #12 завтра", role="admin", chat_type="group")
        self.assertFalse(c.ok)
        self.assertIn("личных сообщениях", c.error)

    def test_admin_command_denied_for_user(self):
        c = parse("статус #12 В работе", role="user", chat_type="private")
        self.assertFalse(c.ok)
        self.assertIn("администраторам", c.error)


# ======== СУПЕРАДМИН ========

class TestSuperadminCommands(unittest.TestCase):
    SA = dict(role="superadmin", chat_type="private")

    def test_add_admin(self):
        c = parse("добавить админа @ivanov", **self.SA)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "add_admin")
        self.assertEqual(c.args["username"], "ivanov")

    def test_remove_admin(self):
        c = parse("убрать админа @ivanov", **self.SA)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "remove_admin")

    def test_list_admins(self):
        c = parse("админы", **self.SA)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "list_admins")

    def test_set_limits(self):
        c = parse("лимиты 15 200", **self.SA)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["per_min"], 15)
        self.assertEqual(c.args["per_day"], 200)

    def test_versions(self):
        c = parse("версии", **self.SA)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.name, "versions")

    def test_rollback(self):
        c = parse("откатить конфиг v1.0", **self.SA)
        self.assertTrue(c.ok, c.error)
        self.assertEqual(c.args["version"], "v1.0")

    def test_superadmin_command_denied_for_admin(self):
        c = parse("админы", role="admin", chat_type="private")
        self.assertFalse(c.ok)
        self.assertIn("суперадминистратору", c.error)

    def test_superadmin_command_denied_in_group(self):
        c = parse("версии", role="superadmin", chat_type="group")
        self.assertFalse(c.ok)
        self.assertIn("личных сообщениях", c.error)


# ======== НЕРАСПОЗНАННОЕ ========

class TestUnknown(unittest.TestCase):
    def test_garbage(self):
        c = parse("бла бла бла")
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)

    def test_typo_close(self):
        c = parse("закрой #12")
        self.assertFalse(c.ok)
        self.assertIn("Не понял команду", c.error)

    def test_missing_value(self):
        c = parse("срок #12", role="admin", chat_type="private")
        self.assertFalse(c.ok)

    def test_empty(self):
        c = parse("   ")
        self.assertFalse(c.ok)

    def test_help(self):
        c = parse("помощь")
        self.assertTrue(c.ok)
        self.assertEqual(c.name, "help")


if __name__ == "__main__":
    unittest.main(verbosity=2)
