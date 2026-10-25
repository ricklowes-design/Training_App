import sys, json, numpy as np
pose, out = sys.argv[1:3]
d = json.load(open(pose))
W = np.array([f['world'] for f in d['frames']])
k = 5; pad = np.pad(W, ((k//2,k//2),(0,0),(0,0)), mode='edge'); W = np.stack([pad[i:i+len(W)] for i in range(k)]).mean(0)
leg = ((W[:,27]+W[:,28])/2 - (W[:,23]+W[:,24])/2).mean(0)
th = np.arctan2(leg[2], leg[1])  # pitch so legs point straight down on average
c, s = np.cos(th), np.sin(th)
R = np.array([[1,0,0],[0,c,s],[0,-s,c]])
L = W @ R.T
print('camera pitch correction deg', round(np.degrees(th),1))
def ang(a,b,c_):
    u=a-b; v=c_-b; return np.degrees(np.arccos(np.clip((u*v).sum(-1)/np.linalg.norm(u,axis=-1)/np.linalg.norm(v,axis=-1),-1,1)))
kL = 180-ang(L[:,23],L[:,25],L[:,27]); kR = 180-ang(L[:,24],L[:,26],L[:,28])
hipMid=(L[:,23]+L[:,24])/2; ank=(L[:,27]+L[:,28])/2
# weight side: hip-mid x relative to the ankles' midpoint, as a share of stance width (camera's view: +x = image right? mediapipe x = subject's left on screen right)
stance = np.abs(L[:,27,0]-L[:,28,0])
shift = (hipMid[:,0]-ank[:,0])/np.maximum(stance,0.05)
sh=(L[:,11]+L[:,12])/2; lean=np.degrees(np.arctan2(sh[:,0]-hipMid[:,0], -(sh[:,1]-hipMid[:,1])))
fwd=np.degrees(np.arctan2(-(sh[:,2]-hipMid[:,2]), -(sh[:,1]-hipMid[:,1])))
yaw=np.degrees(np.arctan2(L[:,23,2]-L[:,24,2], L[:,23,0]-L[:,24,0]))
hipH = ank[:,1]-hipMid[:,1]
json.dump({'fps':d['fps'],'L':L.round(4).tolist()}, open(out,'w'))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
t=np.arange(len(L))/d['fps']
fig,ax=plt.subplots(5,1,figsize=(12,10),sharex=True)
ax[0].plot(t,kL,label='knee bend L');ax[0].plot(t,kR,label='knee bend R');ax[0].legend();ax[0].set_ylabel('deg')
ax[1].plot(t,hipH);ax[1].set_ylabel('hip height m')
ax[2].plot(t,stance);ax[2].set_ylabel('stance m')
ax[3].plot(t,shift);ax[3].axhline(0,c='k',lw=.5);ax[3].set_ylabel('weight shift')
ax[4].plot(t,lean,label='side lean');ax[4].plot(t,yaw,label='hip yaw');ax[4].plot(t,fwd,label='fwd lean');ax[4].legend();ax[4].set_ylabel('deg')
for a in ax: a.grid(alpha=.3); a.set_xticks(np.arange(0,16,0.5),minor=True); a.grid(which='minor',alpha=.1)
plt.tight_layout();plt.savefig(out.replace('.json','.png'),dpi=80)
