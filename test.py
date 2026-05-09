
import requests

res = requests.get('https://api.u2056500.nyat.app:24104/v1/models',headers={"Authorization":"Bearer sk-heyongman"}).json()
print(res)