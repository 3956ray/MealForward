"""One bounded read-only factory session, without a signing/broadcast capability."""
import json
from pathlib import Path
import subprocess
import time
from . import registrar_rpc
from .onboarding_adapter import IntegrationRejected


class FactoryCapacityTransport:
    SELECTORS=('0x38d52e0f','0x7bbecc95','0x7a092896','0x753c6ae8',
        '0x2b20e397','0xcbdb6f6a','0x770e710b','0xa1b141d4')

    def __init__(self,settings,profile):
        self.settings={key:settings[key] for key in ('endpoint','allowedEndpoints','allowedHosts')}
        self.settings.update(factory=profile['factory'],registrar=profile['registrar'],
            factorySelectors=list(self.SELECTORS),broadcastEnabled=False)
        registrar_rpc.endpoint(self.settings)
        self.python=settings['pythonExecutable']
        if type(self.python) is not str or not Path(self.python).is_absolute():self.reject()
        budget=settings['profile']['budget']
        self.limits={key:budget[key] for key in ('maxCalls','maxTotalMs','maxCallMs','maxResponseBytes','maxTotalBytes')}
        caps={'maxCalls':48,'maxTotalMs':20000,'maxCallMs':3000,'maxResponseBytes':1048576,'maxTotalBytes':1048576}
        if any(type(self.limits[key]) is not int or not 1<=self.limits[key]<=cap for key,cap in caps.items()):self.reject()
        if self.limits['maxCallMs']>self.limits['maxTotalMs']:self.reject()
        self.started=time.monotonic();self.calls=0;self.bytes=0

    @staticmethod
    def reject():raise IntegrationRejected('FACTORY_CAPACITY_UNAVAILABLE',503)

    def request(self,method,params,*,deadline):
        if method not in {'eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'}:self.reject()
        registrar_rpc.validate(method,params,self.settings)
        self.calls+=1
        end=min(deadline,self.started+self.limits['maxTotalMs']/1000,
            time.monotonic()+self.limits['maxCallMs']/1000)
        cap=min(262144,self.limits['maxResponseBytes'],self.limits['maxTotalBytes']-self.bytes)
        if self.calls>self.limits['maxCalls'] or end<=time.monotonic() or cap<=0:self.reject()
        packet={'settings':self.settings,'method':method,'params':params,
            'timeout':end-time.monotonic(),'responseLimit':cap}
        child=None
        try:
            child=subprocess.Popen([self.python,'-I','-B',str(Path(registrar_rpc.__file__).resolve()),'--one-request'],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={})
            raw,_=child.communicate(registrar_rpc.encode(packet),timeout=max(.001,end-time.monotonic()-.05))
            if child.returncode or time.monotonic()>end or len(raw)>cap:self.reject()
            self.bytes+=len(raw)
            value=json.loads(raw)
            if type(value) is not dict or set(value)!={'result'}:self.reject()
            return value['result']
        except (OSError,subprocess.TimeoutExpired,ValueError,TypeError):
            self.reject()
        finally:
            if child is not None:
                if child.poll() is None:child.kill()
                try:child.wait(timeout=.05)
                except subprocess.TimeoutExpired:child.kill()
                for pipe in (child.stdin,child.stdout):
                    if pipe:pipe.close()
