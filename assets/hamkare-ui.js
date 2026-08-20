(() => {
  const provinces = ['آذربایجان شرقی','آذربایجان غربی','اردبیل','اصفهان','البرز','ایلام','بوشهر','تهران','چهارمحال و بختیاری','خراسان جنوبی','خراسان رضوی','خراسان شمالی','خوزستان','زنجان','سمنان','سیستان و بلوچستان','فارس','قزوین','قم','کردستان','کرمان','کرمانشاه','کهگیلویه و بویراحمد','گلستان','گیلان','لرستان','مازندران','مرکزی','هرمزگان','همدان','یزد'];
  const $ = (selector) => document.querySelector(selector);
  const provinceSelect = $('#province');
  const jobProvince = $('#job-province');
  const status = $('#register-result');
  const submit = $('#submit-btn');
  const roleInput = $('#selected-role');
  const roleChip = $('#role-chip b');

  provinces.forEach((name, index) => {
    const value = String(index + 1).padStart(2, '0');
    [provinceSelect, jobProvince].forEach((select) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = name;
      select.append(option);
    });
  });

  $('#age-accept').addEventListener('click', () => {
    $('#age-gate').hidden = true;
    document.body.style.overflow = '';
  });
  document.body.style.overflow = 'hidden';

  jobProvince.addEventListener('change', () => {
    const option = jobProvince.options[jobProvince.selectedIndex];
    $('#province-note').textContent = jobProvince.value
      ? `ثبت درخواست برای استان «${option.textContent}» فعال است.`
      : 'برای همهٔ استان‌ها امکان ثبت درخواست وجود دارد.';
    provinceSelect.value = jobProvince.value;
  });

  document.querySelectorAll('.opportunity').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.opportunity').forEach((item) => item.classList.remove('selected'));
      card.classList.add('selected');
      roleInput.value = card.dataset.role || '';
      roleChip.textContent = roleInput.value;
    });
  });

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.className = `form-status show${isError ? ' error' : ''}`;
  };

  $('#register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const payload = {
      name: form.name.value.trim(),
      phone: form.phone.value.replace(/\D/g, ''),
      province: form.province.value,
      answers: {
        q1: $('#q1').value,
        q2: $('#q2').value,
        q3: $('#q3').value,
        role: roleInput.value,
      },
    };
    if (!/^09\d{9}$/.test(payload.phone)) {
      setStatus('شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد.', true);
      return;
    }

    submit.disabled = true;
    submit.textContent = 'در حال ثبت درخواست…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'ثبت درخواست انجام نشد.');
      if (data.existing) {
        setStatus(data.message || 'این شماره قبلاً ثبت شده است. برای بازیابی کد با پشتیبانی تماس بگیر.');
      } else {
        setStatus(`درخواست با موفقیت ثبت شد. کد ثبت تو: ${data.tracking} — پیگیری وضعیت فقط از داخل اپلیکیشن همکاره انجام می‌شود.`);
        form.reset();
      }
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'پاسخ سرور طول کشید؛ دوباره تلاش کن.' : (error.message || 'ارتباط با سامانه برقرار نشد.'), true);
    } finally {
      clearTimeout(timeout);
      submit.disabled = false;
      submit.innerHTML = 'ثبت درخواست و دریافت کد <span>←</span>';
    }
  });
})();
