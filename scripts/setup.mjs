// سكربت التجهيز: يضيف منصة أندرويد أو آيفون، يولّد الأيقونات، ويضبط صلاحيات التنبيهات.
// الاستخدام:  node scripts/setup.mjs android   أو   node scripts/setup.mjs ios
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2] || 'android';
if (!['android', 'ios'].includes(platform)) {
  console.error('اكتب android أو ios');
  process.exit(1);
}
const run = (cmd) => {
  console.log('\n> ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
};

if (!fs.existsSync('node_modules')) run('npm install');

if (!fs.existsSync(platform)) run(`npx cap add ${platform}`);

run(`npx capacitor-assets generate --${platform}`);

if (platform === 'android') {
  // أيقونة التنبيه الصغيرة
  const drawableDir = path.join('android', 'app', 'src', 'main', 'res', 'drawable');
  fs.mkdirSync(drawableDir, { recursive: true });
  fs.copyFileSync(path.join('resources', 'android', 'ic_stat_munjiz.xml'), path.join(drawableDir, 'ic_stat_munjiz.xml'));

  // صلاحيات التنبيهات والمنبّهات الدقيقة
  const mf = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  let xml = fs.readFileSync(mf, 'utf8');
  const perms = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.VIBRATE'
  ];
  let add = '';
  for (const p of perms) {
    if (!xml.includes(`"${p}"`)) add += `    <uses-permission android:name="${p}" />\n`;
  }
  if (add) {
    xml = xml.replace('</manifest>', add + '</manifest>');
    fs.writeFileSync(mf, xml);
    console.log('تمت إضافة الصلاحيات إلى AndroidManifest.xml');
  }
}

if (platform === 'ios') {
  const pl = path.join('ios', 'App', 'App', 'Info.plist');
  if (fs.existsSync(pl)) {
    let x = fs.readFileSync(pl, 'utf8');
    if (!x.includes('NSFaceIDUsageDescription')) {
      x = x.replace('</dict>\n</plist>', '\t<key>NSFaceIDUsageDescription</key>\n\t<string>لفتح التطبيق بالوجه</string>\n</dict>\n</plist>');
      fs.writeFileSync(pl, x);
      console.log('تمت إضافة وصف Face ID إلى Info.plist');
    }
  }
}

run(`npx cap sync ${platform}`);

console.log('\nتم التجهيز بنجاح.');
console.log(platform === 'android'
  ? 'الخطوة التالية: npm run android  (يفتح Android Studio ثم اضغط Run)'
  : 'الخطوة التالية: npm run ios  (يفتح Xcode ثم اختر فريقك وجهازك واضغط Run)');
