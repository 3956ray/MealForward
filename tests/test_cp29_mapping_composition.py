"""Run with installed MealForward dependencies on a real dev checkout."""
import unittest
from server.manual_business.cp29_composition import verify_business_mapping
from server.manual_business.cp29_identity import fingerprint

KEY=bytes(range(32));ENV='7fe95f70-e5cc-4c3c-beed-a133e81268dc'
P=fingerprint(KEY,ENV,'partner');O=fingerprint(KEY,ENV,'owner')
OWNER='0x'+'a'*40;SERVICE='0x'+'b'*40


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.config={'purpose':'cp28-new-business','origin':'http://127.0.0.1:15287',
          'cp29WorkActors':{'partnerActorId':'cp29-partner','ownerActorId':'cp29-owner'},
          'trustedSubjects':{P:{'actorId':'cp29-partner','revision':1},
                             O:{'actorId':'cp29-owner','revision':1}},
          'participants':{'admin':OWNER,'supporter':OWNER,'merchant':OWNER,'issuer':SERVICE,'operator':SERVICE}}
    def test_exact_mapping_accepted(self):self.assertTrue(verify_business_mapping(self.config))
    def test_wrong_role_mapping_rejected(self):
        self.config['trustedSubjects'][P]['actorId']='cp29-owner'
        with self.assertRaises(ValueError):verify_business_mapping(self.config)
    def test_unknown_origin_rejected(self):
        self.config['origin']='http://127.0.0.1:15207'
        with self.assertRaises(ValueError):verify_business_mapping(self.config)
    def test_owner_service_conflict_rejected(self):
        self.config['participants']['operator']=OWNER
        with self.assertRaises(ValueError):verify_business_mapping(self.config)
    def test_one_subject_cannot_claim_both_roles(self):
        del self.config['trustedSubjects'][O]
        with self.assertRaises(ValueError):verify_business_mapping(self.config)

if __name__=='__main__':unittest.main()
