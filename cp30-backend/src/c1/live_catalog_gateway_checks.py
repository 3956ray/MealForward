"""Offline multi-meal dispatch and original publication recovery checks."""
from types import SimpleNamespace
from unittest.mock import Mock
import unittest
from .live_checks import LiveChecks,Client
from .live_gateway import IntegrationRejected

class Checks(unittest.TestCase):
    def setUp(self):
        LiveChecks.setUp(self)
        self.first='1'*64;self.second='2'*64
        self.store={'meal':self.first,'profile':{},'snapshot':{'timestamp':'100'},'revision':3}
    def test_all_known_meals_are_observed_and_projected_without_replacing_original_profile(self):
        profile={'binding':{'storeId':'0x'+'a'*64},'registrationEvidence':{'catalog':[{'terms':{'mealId':'0x'+self.first}}]}}
        self.store['profile']=profile
        material={'registration':{'id':'original','record':{}},'store':self.store,'catalogMeals':['0x'+self.second,'0x'+self.first]}
        observer=Mock();observer.read_finalized.return_value={'trusted':'snapshot'}
        self.gateway.observer_factory=Mock(return_value=observer)
        self.gateway.projection=Mock();self.gateway.projection.finalized_snapshot_rows.return_value={'rows':'verified'}
        self.gateway._seed_or_refresh(material)
        observer.read_finalized.assert_called_once_with(meal_ids=['0x'+self.first,'0x'+self.second])
        self.assertEqual(self.gateway.projection.finalized_snapshot_rows.call_args.args[2],{'0x'+self.first:self.first,'0x'+self.second:self.second})
        self.assertEqual(self.worker.calls[-1][1]['profile'],profile)
        for extra in [['0x'+'3'*64,'0x'+'4'*64],['../private'],['0x'+'0'*64]]:
            with self.assertRaises(IntegrationRejected):self.gateway._meal_aliases({**material,'catalogMeals':['0x'+self.second]+extra})
    def publication(self,hash_=None):
        intent={'id':'11111111-1111-4111-8111-111111111111','store':'a'*64,'action':'publish','stage':'UNKNOWN','revision':2,'private_record':None,'signed_quote':None,'observer_record':{'original':True} if hash_ else None,'transaction_hash':hash_}
        material={'intent':intent,'store':self.store,'attempts':{},'catalogMeals':['0x'+self.first,'0x'+self.second]}
        def fixed(q):
            if q.get('op')=='registration':return {'registration':{'id':'original'},'store':self.store}
            if q.get('op')=='tasks':return {'items':[intent]}
            return material
        self.worker.responses['live_material']=fixed
        return intent,material
    def test_absent_catalog_service_preserves_existing_readiness_and_does_not_use_operator(self):
        self.publication()
        self.assertTrue(self.gateway.ready_for_store('original'))
        self.assertEqual(self.gateway.step()['state'],'WAIT_CATALOG_CONFIGURATION')
        self.assertFalse(any(c[0]=='execute' for client in self.clients.values() for c in client.calls))
    def test_unknown_catalog_request_only_looks_up_the_original(self):
        intent,_=self.publication();catalog=Client();self.gateway.clients['catalogAuthority']=catalog
        self.assertEqual(self.gateway.step()['state'],'ORIGINAL_PRIVATE_UNKNOWN')
        self.assertEqual(catalog.calls,[('lookup',intent['id'])])
    def test_known_catalog_hash_never_signs_again_and_projection_keeps_all_meals(self):
        hash_='0x'+'b'*64;intent,material=self.publication(hash_)
        catalog=Client();self.gateway.clients['catalogAuthority']=catalog
        proof={'original':intent['observer_record'],'transactionHash':hash_,'snapshot':{'verified':True}}
        observer=Mock();observer.verify_original_operation.return_value=proof
        self.gateway.observer_factory=Mock(return_value=observer)
        self.gateway.projection=Mock();self.gateway.projection.projection_rows.return_value={'receipt':'verified'}
        self.worker.responses['live_projection']={'state':'FINAL_SUCCEEDED'}
        self.assertEqual(self.gateway.step()['state'],'FINAL_SUCCEEDED');self.assertEqual(catalog.calls,[])
        observer.verify_original_operation.assert_called_once_with(intent['observer_record'],hash_,meal_ids=['0x'+self.first,'0x'+self.second])
        request=self.worker.calls[-1][1]
        self.assertIn('listingIntentId',request);self.assertRegex(request['listingOpId'],'^0x[0-9a-f]{64}$')
        self.assertEqual(self.gateway.projection.projection_rows.call_args.args[3],{'0x'+self.first:self.first,'0x'+self.second:self.second})
    def test_catalog_image_reads_exact_version_without_creating_an_operation(self):
        self.api.responses['live_catalog_image']={'image':'cG5n'}
        result=self.gateway.handle('GET','/v1/stores/'+'a'*64+'/meals/'+self.second+'/versions/2/image',{},None,{})
        self.assertEqual(result,{'image':'cG5n'})
        method,q,readonly=self.api.calls[-1];self.assertEqual(method,'live_catalog_image');self.assertEqual(q['version'],'2');self.assertTrue(readonly)

if __name__=='__main__':unittest.main()
