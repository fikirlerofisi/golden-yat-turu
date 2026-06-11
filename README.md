# Golden Yat Turu — Operasyon Paneli

İstanbul Boğazı yat turu rezervasyon ve check-in yönetim uygulaması.
Saf HTML/CSS/JS + Supabase (gerçek zamanlı çok cihaz senkronizasyonu).

---

## Kurulum

### 1. Supabase projesi oluşturun

1. [supabase.com](https://supabase.com) → **New Project**
2. İsim: `golden-yat-turu` (veya istediğiniz bir isim)
3. Şifre belirleyin, bölge olarak `eu-central-1` (Frankfurt) seçin
4. Proje oluşana kadar bekleyin (~1-2 dk)

### 2. Veritabanı şemasını çalıştırın

1. Dashboard → **SQL Editor** → **New Query**
2. `supabase/schema.sql` dosyasının tüm içeriğini yapıştırın
3. **Run** düğmesine basın
4. Hata çıkmazsa tablo ve RLS politikaları hazır

### 3. Personel kullanıcıları oluşturun

1. Dashboard → **Authentication** → **Users** → **Add User**
2. Her personel için e-posta + şifre girin (ör. `betul@golden.com`)
3. Kullanıcı oluşturulunca profil tablosuna otomatik eklenir
4. Gerekirse profil adını güncelleyin:  
   **Table Editor** → `profiles` → ilgili satırda `full_name` düzenleyin

### 4. Uygulama konfigürasyonunu doldurun

`js/config.js` dosyasını açın ve şu iki satırı doldurun:

```js
export const SUPABASE_URL      = 'https://XXXX.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

Değerleri bulmak için:  
Dashboard → **Project Settings** → **API** → **Project URL** ve **anon / public** anahtarı

> **Güvenlik:** `anon` anahtarı tarayıcıda görünür, bu normaldir.  
> RLS politikaları sayesinde yalnızca oturum açmış kullanıcılar veri okuyabilir/yazabilir.

### 5. Realtime'ı etkinleştirin

1. Dashboard → **Database** → **Replication**
2. `Source` altında `supabase_realtime` publication'ı seçin
3. `bookings` ve `tours` tablolarını etkinleştirin  
   *(veya `schema.sql` içindeki `ALTER PUBLICATION` satırları bunu zaten yaptıysa atlayin)*

---

## Yerel test (geliştirme)

Tarayıcıda doğrudan `index.html` dosyasını açmak ES module kısıtlaması nedeniyle çalışmaz.  
Küçük bir statik sunucu kullanın:

```bash
# Node.js varsa:
npx serve .

# Python varsa:
python -m http.server 8080
```

Ardından `http://localhost:3000` (veya `8080`) adresini açın.

---

## Netlify ile yayın (önerilen)

1. [netlify.com](https://netlify.com) → ücretsiz hesap açın
2. **Sites** → **Add new site** → **Deploy manually**
3. `C:\claude\Golden` klasörünü sürükleyip bırakın  
   *(veya ZIP'leyin, netlify.com/drop adresine sürükleyin)*
4. Netlify size ücretsiz bir `*.netlify.app` URL'si verir
5. Ekibinizle bu URL'yi paylaşın — telefonla da açılır

**Güncelleme:** Dosyaları değiştirince tekrar sürükle-bırak yapın veya  
Netlify CLI ile otomatikleştirin: `npx netlify-cli deploy --prod --dir .`

---

## GitHub Pages ile yayın (alternatif)

```bash
# Projeyi bir GitHub reposuna aktarın
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/KULLANICI/golden-yat.git
git push -u origin main
```

GitHub repo → **Settings** → **Pages** → Source: `main` branch → **Save**  
URL: `https://KULLANICI.github.io/golden-yat/`

---

## Dropdown seçeneklerini güncelleme

`js/config.js` içindeki `OPTIONS` nesnesini düzenleyin:

```js
yachts:     ['River', 'River Storm'],
agencies:   ['', 'Rixos', 'Ramada', 'Çırağan'],
staffList:  ['', 'Betül', 'Nurşah', 'Aleyna'],
// ... vb.
```

---

## Kullanım kılavuzu

### Ofis — Sabah hazırlık

1. Uygulamayı açın, personel hesabınızla giriş yapın
2. Tarih seçicide bugünün tarihini seçin
3. **+ Tur Ekle** → Tur kodu (T1) ve kalkış saatini girin
4. **+ Rezervasyon Ekle** → Her müşteriyi tek tek ekleyin
   - Zorunlu: Ad, Yat, Pax
   - İsteğe bağlı: Acenta, Kaynak, Telefon, Ödeme, Personel, Not

### İskele — Tur saati

1. Telefonda uygulamayı açın → Aynı tarih/tur otomatik gelir
2. **Check-in** sekmesine geçin
3. Gelen müşterinin kartına dokunun → Yeşile döner ✓
4. Yanlışlıkla dokundunuzsa tekrar dokunun → Geri alır
5. Üstteki **Geldi / Gelmedi** sayaçları anlık güncellenir
6. Başka bir telefon/bilgisayardan bakan personel de anlık görür

---

## Teknik notlar

- **Mimari:** Statik HTML/CSS/JS + Supabase JS SDK (CDN, `esm.sh`)
- **Realtime:** Supabase Postgres Changes → tüm cihazlarda anlık
- **Auth:** Supabase Auth (e-posta + şifre, kalıcı oturum)
- **Veri:** Supabase Postgres (ücretsiz plan: 500 MB, yeterli)
- **Deploy:** Netlify / GitHub Pages (sunucu gerekmez)
