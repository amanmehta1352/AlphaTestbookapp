A={'B':'Biology','S':'Static GK','CA':'Current Affairs','E':'Economy','C':'Chemistry','P':'Physics','Po':'Polity','G':'Geography','H':'History','Co':'Computer'}
RAW={
'C06S1':'B S CA B B E C B Co E Po G B Po H P CA CA H G B G Po Po CA CA G C P G B S P Co B CA H B CA S G E E S CA CA H P Po P',
'C06S3':'E G S P Co CA Po P CA CA G CA B B H B G H Po B H G S C B Po B CA G S S P CA - G C G CA E S C G G C G G G Po CA Po',
'C07S1':'P CA CA C G CA Po E G P Po CA H CA B C CA B G S P H E Po B B E Co H CA Po H B Co C C G CA CA B S B G G Po E G Po G B',
'E05S3':'Po B Co Po P H CA H E G CA B CA C C G G Po CA B G B G P B G E E B S C B CA G G S B C Co E Po S H Po S CA H CA G S',
'M05S3':'Po H E H CA G C B P S C S G G CA C Po H G P G Po CA C B B Co B Co CA B Po E CA CA B G Po E CA H B CA S B S G H Po B',
'M07S2':'G CA G E Co B Po G B B G E G P B CA B CA C Po B C S P G P S H B H Po CA G E P S B H E P CA B CA G H S B Po G Co',
}
GA={}
for k,v in RAW.items():
    t=v.split(); assert len(t)==50,(k,len(t))
    for i,x in enumerate(t):
        if x!='-': GA[(k,i+1)]=A[x]
