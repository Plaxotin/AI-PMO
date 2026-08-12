#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Юнит-тесты модуля feedback.py (v2.2.4) — только парсинг, без Google."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import feedback

BOT = "Plaxotin_task_bot"


class TestParseFeedback(unittest.TestCase):

    def test_idea_ru(self):
        self.assertEqual(
            feedback.parse_feedback_command("/идея добавить напоминания", BOT),
            ("Идея", "добавить напоминания"))

    def test_bug_ru(self):
        self.assertEqual(
            feedback.parse_feedback_command("/баг кнопка не работает", BOT),
            ("Баг", "кнопка не работает"))

    def test_idea_en(self):
        self.assertEqual(
            feedback.parse_feedback_command("/idea dark mode", BOT),
            ("Идея", "dark mode"))

    def test_bug_en(self):
        self.assertEqual(
            feedback.parse_feedback_command("/bug crash", BOT),
            ("Баг", "crash"))

    def test_case_insensitive(self):
        self.assertEqual(
            feedback.parse_feedback_command("/БАГ сломалось", BOT),
            ("Баг", "сломалось"))

    def test_with_own_mention(self):
        self.assertEqual(
            feedback.parse_feedback_command(f"/идея@{BOT} сделай фичу", BOT),
            ("Идея", "сделай фичу"))

    def test_other_bot_mention_ignored(self):
        self.assertIsNone(
            feedback.parse_feedback_command("/идея@OtherBot фича", BOT))

    def test_empty_text_after_command(self):
        self.assertEqual(
            feedback.parse_feedback_command("/баг", BOT), ("Баг", ""))

    def test_plain_message_not_feedback(self):
        self.assertIsNone(
            feedback.parse_feedback_command("просто текст", BOT))

    def test_command_inside_text_not_feedback(self):
        self.assertIsNone(
            feedback.parse_feedback_command("а вот /баг посередине", BOT))

    def test_empty_string(self):
        self.assertIsNone(feedback.parse_feedback_command("", BOT))

    def test_none(self):
        self.assertIsNone(feedback.parse_feedback_command(None, BOT))

    def test_leading_spaces(self):
        self.assertEqual(
            feedback.parse_feedback_command("   /идея   текст с пробелами ", BOT),
            ("Идея", "текст с пробелами"))

    def test_multiline_text(self):
        self.assertEqual(
            feedback.parse_feedback_command("/баг строка1\nстрока2", BOT),
            ("Баг", "строка1\nстрока2"))

    def test_aliases_map_complete(self):
        for cmd, expected in [("/идея", "Идея"), ("/idea", "Идея"),
                              ("/баг", "Баг"), ("/bug", "Баг")]:
            r = feedback.parse_feedback_command(f"{cmd} х", BOT)
            self.assertIsNotNone(r)
            self.assertEqual(r[0], expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
