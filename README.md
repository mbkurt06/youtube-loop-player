# YouTube Loop Player

YouTube videolarında A–B aralığını belirlenen sayıda tekrar oynatan küçük bir PWA.

## Özellikler
- YouTube bağlantısı / video kimliği ile video açma
- A ve B noktalarını videonun mevcut anından alma
- ±1 saniye düzeltme
- tekrar sayısı ve oynatma hızı
- tekrarlar arası bekleme
- kayıtlı bölümler
- son videolar
- yerel MP4 / MP3 / M4A dosyalarını cihazda saklama
- doğrudan medya URL'lerini indirip çevrimdışı saklama
- yerel yardımcı sunucu üzerinden, indirme hakkına sahip olduğun YouTube videolarını çevrimdışı saklama
- PWA desteği

## Kurulum

```bash
python3 -m pip install -r requirements.txt
```

## Çalıştırma

8080 doluysa 8081 kullan:

```bash
python3 server.py 8081
```

Mac'te aç:

```
http://localhost:8081
```

Telefon aynı Wi-Fi'daysa Mac'in yerel IP adresini kullan:

```
http://MAC_IP_ADRESI:8081
```

## YouTube'dan çevrimdışı kaydetme

1. YouTube bağlantısını gir.
2. “Bu videoyu çevrimdışı kaydetme hakkım var” kutusunu işaretle.
3. “YouTube’dan indir” düğmesine bas.
4. Video önce Mac'teki yerel sunucu tarafından alınır, ardından tarayıcının IndexedDB deposuna kaydedilir.
5. Kaydedilen video “Çevrimdışı medya” altında açılabilir ve A–B tekrar sistemiyle kullanılabilir.

Bu özellik yalnızca indirme/kopyalama hakkına sahip olduğun içerikler için kullanılmalıdır.
