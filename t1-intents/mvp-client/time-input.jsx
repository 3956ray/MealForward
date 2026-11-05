import {t as tr} from './locale.mjs';
import {useLanguage} from './locale-react.jsx';
import React from 'react';
// Keep the separator outside editable fields; partial input is validated on save.
export function TimeInput({label,value='',onChange}) {
 useLanguage();
 const [hours='',minutes='']=value.split(':');
 const update=(part,raw)=>{const digits=raw.replace(/\D/g,'').slice(0,2);onChange(part===0?digits+':'+minutes:hours+':'+digits);};
 const pad=(part,raw)=>{if(raw.length===1)update(part,raw.padStart(2,'0'));};
 return <div className="time-field"><span>{label}</span><div className="time-input" role="group" aria-label={label}><input aria-label={label+tr("小时")} inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="HH" value={hours} onChange={e=>update(0,e.target.value)} onBlur={()=>pad(0,hours)}/><span aria-hidden="true">:</span><input aria-label={label+tr("分钟")} inputMode="numeric" pattern="[0-9]*" maxLength={2} placeholder="MM" value={minutes} onChange={e=>update(1,e.target.value)} onBlur={()=>pad(1,minutes)}/></div></div>;
}
