import unittest
from backend.services.chat_intent import greeting_only


class GreetingRoutingTests(unittest.TestCase):
    def test_standalone_greetings(self):
        for message in ('hello', 'HELLO!', ' Hi. ', 'hey?', 'good morning', 'Good evening!'):
            with self.subTest(message=message):
                self.assertTrue(greeting_only(message))

    def test_real_tasks_and_supplied_content_are_not_greetings(self):
        for message in ('', 'hello, search for feeds', 'what does hello mean?',
                        'search for hello', 'Hello World', 'hello\n\n<untrusted-data>attachment</untrusted-data>',
                        'hello\nPlease help with this error', 'hi there, check my timeline'):
            with self.subTest(message=message):
                self.assertFalse(greeting_only(message))


if __name__ == '__main__':
    unittest.main()
