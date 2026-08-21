(() => {
  const provinces = ['آذربایجان شرقی','آذربایجان غربی','اردبیل','اصفهان','البرز','ایلام','بوشهر','تهران','چهارمحال و بختیاری','خراسان جنوبی','خراسان رضوی','خراسان شمالی','خوزستان','زنجان','سمنان','سیستان و بلوچستان','فارس','قزوین','قم','کردستان','کرمان','کرمانشاه','کهگیلویه و بویراحمد','گلستان','گیلان','لرستان','مازندران','مرکزی','هرمزگان','همدان','یزد'];
  const province = document.querySelector('#province');
  const form = document.querySelector('#register-form');
  const submit = document.querySelector('#submit-btn');
  const status = document.querySelector('#register-result');
  const role = document.querySelector('#role');

  provinces.forEach((name, index) => {
    const option = document.createElement('option');
    option.value = String(index + 1).padStart(2, '0');
    option.textContent = name;
    province.append(option);
  });

  document.querySelectorAll('[data-role]').forEach((link) => {
    link.addEventListener('click', () => {
      role.value = link.dataset.role || '';
    });
  });

  const showMessage = (message, error = false) => {
    status.hidden = false;
    status.className = `form-message full ${error ? 'error' : 'success'}`;
    status.innerHTML = error ? message : `✓ ${message}<small>پیگیری وضعیت فقط از داخل اپلیکیشن همکاره امکان‌پذیر است.</small>`;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const phone = form.phone.value.replace(/\D/g, '');
    if (!/^09\d{9}$/.test(phone)) {
      showMessage('شماره همراه باید با 09 شروع شود و 11 رقم باشد.', true);
      return;
    }
    const payload = {
      name: form.name.value.trim(),
      phone,
      province: form.province.value,
      role: form.role.value,
      workMode: form.workMode.value,
      answers: { q1: '0', q2: 'diploma', q3: form.workMode.value === 'دورکاری' ? 'no' : 'yes', role: form.role.value, workMode: form.workMode.value },
    };
    submit.disabled = true;
    submit.textContent = 'در حال ثبت امن…';
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
      showMessage(data.existing ? (data.message || 'این شماره قبلاً ثبت شده است.') : `درخواست شما با موفقیت ثبت شد. کد ثبت: ${data.tracking}`);
      if (!data.existing) form.reset();
    } catch (error) {
      showMessage(error.name === 'AbortError' ? 'پاسخ سرور طول کشید؛ دوباره تلاش کنید.' : (error.message || 'ارتباط با سامانه برقرار نشد.'), true);
    } finally {
      clearTimeout(timeout);
      submit.disabled = false;
      submit.textContent = 'ثبت رایگان درخواست';
    }
  });
})();
