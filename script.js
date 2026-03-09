const today = new Date().toISOString().slice(0,10);

const urlParams = new URLSearchParams(window.location.search);
const dateParam = urlParams.get('date');
const selectedDate = dateParam || today;

function loadArchive() {
  const today = new Date().toISOString().slice(0, 10);
  fetch('dates.json')
    .then(res => res.json())
    .then(dates => {
      const archiveList = document.getElementById('archive-list');
      if (!archiveList) return;
      const availableDates = dates
        .filter(date => date <= today)
        .sort((a, b) => b.localeCompare(a));
      availableDates.forEach(date => {
        const link = document.createElement('a');
        link.href = `index.html?date=${date}`;
        link.textContent = new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        archiveList.appendChild(link);
      });
    })
    .catch(_ => {
      const archiveList = document.getElementById('archive-list');
      if (archiveList) {
        archiveList.innerHTML = '<p>Unable to load archive dates.</p>';
      }
    });
}

function loadData(date) {
  fetch(`/data/${date}.json`)
    .then(res => res.json())
    .then(data => {

      document.getElementById("question").textContent = data.question;

      const choicesDiv = document.getElementById("options");
      choicesDiv.innerHTML = '';
      document.getElementById("result").textContent = '';

      data.options.forEach((choice, index) => {

        const button = document.createElement("button");
        button.textContent = choice;

        button.onclick = () => {
          if(choice === data.answer){
            document.getElementById("result").textContent = "Correct!";
            button.style.backgroundColor = "green";
            button.style.color = "white";
          } else {
            document.getElementById("result").textContent = "Wrong!";
            button.style.backgroundColor = "red";
            button.style.color = "white";
          }

          document.querySelectorAll('#options button').forEach(btn => {
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
          });
        };

        choicesDiv.appendChild(button);

      });

    })
    .catch(error => {
      document.getElementById("question").textContent = "Oops, Grizz forgot to add today's question!";
      document.getElementById("result").textContent = "Please berate him on discord to fix this issue!";
      document.getElementById("options").innerHTML = '';
    });
}

loadData(selectedDate);

if (window.location.pathname.endsWith('archive.html')) {
  loadArchive();
}


