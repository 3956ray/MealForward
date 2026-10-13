"""Explicit, bounded public build manifest; never a general filesystem server."""
import os
from pathlib import Path
import re
import stat

TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
    '.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
    '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml',
    '.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'}
FILE_LIMIT=8*1024*1024
BUILD_LIMIT=32*1024*1024


class StaticAssets:
    def __init__(self,root,files):
        if (type(root) is not str or not Path(root).is_absolute()
            or Path(root).as_posix()!=root or '..' in Path(root).parts
            or type(files) is not list or not 1<=len(files)<=256
            or any(type(name) is not str for name in files)
            or len(set(files))!=len(files) or 'index.html' not in files):
            raise ValueError('INVALID_STATIC_CONFIGURATION')
        self.assets={};total=0
        for name in files:
            parts=name.split('/')
            if (len(name)>512 or any(not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*',part) for part in parts)
                or parts[0]=='v1' or Path(name).suffix not in TYPES):
                raise ValueError('INVALID_STATIC_CONFIGURATION')
            # Open every component without following symlinks, including root.
            descriptor=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
            try:
                for component in (*Path(root).parts[1:],*parts[:-1]):
                    child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor)
                    os.close(descriptor);descriptor=child
                file=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=descriptor)
                with os.fdopen(file,'rb') as stream:
                    info=os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_size>FILE_LIMIT:
                        raise ValueError('INVALID_STATIC_ASSET')
                    content=stream.read(FILE_LIMIT+1)
                total+=len(content)
                if len(content)>FILE_LIMIT or total>BUILD_LIMIT:raise ValueError('STATIC_BUILD_LIMIT')
                self.assets['/'+name]=(TYPES[Path(name).suffix],content)
            finally:os.close(descriptor)
        # Snapshot the approved build at startup; later disk changes need restart.
        self.assets['/']=self.assets['/index.html']

    @classmethod
    def from_config(cls,config):
        if 'staticRoot' not in config and 'staticFiles' not in config:return None
        return cls(config.get('staticRoot'),config.get('staticFiles'))

    def get(self,path):return self.assets.get(path)
