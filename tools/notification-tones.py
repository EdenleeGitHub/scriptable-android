"""Generate original short PCM notification cues; no third-party audio assets."""
import math
from pathlib import Path
import struct
import wave

root=Path(__file__).resolve().parent.parent/'app/src/main/res/raw'
root.mkdir(parents=True,exist_ok=True)
motifs={'accept':[659,880],'alert':[880,660,880],'complete':[523,659,784],'event':[698,880],
        'failure':[392,311],'piano_error':[349,277,220],'piano_success':[523,659,784,1047],'popup':[1047]}
rate=22050
for name,notes in motifs.items():
    output=[]
    for frequency in notes:
        count=int(rate*0.13)
        for index in range(count):
            t=index/rate
            envelope=min(1,t/.008)*math.exp(-t*22)*(max(0,(count-index)/(.02*rate)))
            envelope=min(1,envelope)
            value=.16*envelope*(math.sin(2*math.pi*frequency*t)+.2*math.sin(2*math.pi*frequency*2*t))
            output.append(struct.pack('<h',int(value*32767)))
        output.extend([b'\0\0']*int(rate*.025))
    with wave.open(str(root/f'notification_{name}.wav'),'wb') as sound:
        sound.setnchannels(1);sound.setsampwidth(2);sound.setframerate(rate);sound.writeframes(b''.join(output))
print(f'{len(motifs)} original notification tones prepared.')
