import React,{useEffect,useSyncExternalStore} from 'react';
import {Languages} from 'lucide-react';
import {getLanguage,getLocale,setLanguage,subscribeLanguage,t} from './locale.mjs';
export function useLanguage(){const language=useSyncExternalStore(subscribeLanguage,getLanguage,()=> 'zh');return language;}
export function LanguageSwitch(){const language=useLanguage();
 useEffect(()=>{document.documentElement.lang=getLocale();document.title=language==='en'?'MealForward':'留膳 · MealForward';},[language]);
 return <label className="language-switch" title={language==='en'?'Choose language':'选择语言'}><Languages size={20} aria-hidden="true"/><span className="language-current" aria-hidden="true">{language==='en'?'EN':'中文'}</span><select aria-label="Language / 语言" value={language} onChange={e=>setLanguage(e.target.value)}><option value="zh" lang="zh-CN">中文</option><option value="en" lang="en">English</option></select></label>;
}
