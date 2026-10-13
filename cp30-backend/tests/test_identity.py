"""ASCII canonical-email contract, independent expected vectors (not login proof)."""
import hashlib
import hmac
import unittest
from c1.fixtures import canonical_email,email_key

VALID=[
 ('a@EXAMPLE.TEST','a@example.test'),(' A@EXAMPLE.TEST ','A@example.test'),
 ('a+b@example.test','a+b@example.test'),('a.b@example.test','a.b@example.test'),
 ('a-b@example.test','a-b@example.test'),('a_b@example.test','a_b@example.test'),
 ('a'*64+'@example.test','a'*64+'@example.test'),
 ('a@'+'b'*63+'.test','a@'+'b'*63+'.test'),
 ('a@one-two.test','a@one-two.test'),('a@b','a@b'),
 ('x'*64+'@'+'a'*63+'.'+'b'*63+'.'+'c'*61,'x'*64+'@'+'a'*63+'.'+'b'*63+'.'+'c'*61),
 ('!#$%&\'*+-/=?^_`{|}~@example.test','!#$%&\'*+-/=?^_`{|}~@example.test'),
]
INVALID=[
 'a'*65+'@example.test','a@'+'b'*64+'.test',
 'x'*64+'@'+'a'*63+'.'+'b'*63+'.'+'c'*62,
 '.a@example.test','a.@example.test','a..b@example.test','"a"@example.test',
 'a b@example.test','a\tb@example.test','a@example.test\n','\ta@example.test',
 'é@example.test','a@例子.test','a＠example.test','a@@example.test',
 '@example.test','a@','a@example..test','a@-example.test','a@example-.test',
 'a@exam_ple.test','a@.example.test','a@example.test.','a\x00@example.test',
]

class IdentityVectors(unittest.TestCase):
    def test_36_directed_ascii_vectors(self):
        self.assertEqual(len(VALID)+len(INVALID),36)
        for raw,expected in VALID:
            with self.subTest(vector=VALID.index((raw,expected))):self.assertEqual(canonical_email(raw),expected)
        for index,raw in enumerate(INVALID):
            with self.subTest(rejected=index):
                with self.assertRaises(ValueError):canonical_email(raw)

    def test_length_prefix_domain_and_alias_separation(self):
        key=bytes(range(32))
        expected=hmac.new(key,b'MCPAY-C1-EMAIL-v1\x00\x00\x00\x01n\x00\x00\x00\x03a@b',hashlib.sha256).hexdigest()
        self.assertEqual(email_key('n',' a@B ',key),expected)
        values=[email_key('n',value,key) for value in ['a@b','A@b','a+x@b','a.x@b']]
        self.assertEqual(len(set(values)),4)
        self.assertNotEqual(email_key('other','a@b',key),expected)

if __name__=='__main__':unittest.main()
