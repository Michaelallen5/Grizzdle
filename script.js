const today = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Australia/Perth'
});

const urlParams = new URLSearchParams(window.location.search);
const dateParam = urlParams.get('date');
const selectedDate = dateParam || today;

function loadData(date) {
  fetch(`./data/${date}.json`)
    .then(res => res.json())
    .then(data => {

      const savedAnswers = JSON.parse(localStorage.getItem('answers')) || {};
      let correctCount = Number(localStorage.getItem('correctCount')) || 0;
      let incorrectCount = Number(localStorage.getItem('incorrectCount')) || 0;

      document.getElementById("correctCount").textContent = correctCount;
      document.getElementById("incorrectCount").textContent = incorrectCount;
      document.getElementById("question").textContent = data.question;

      const choicesDiv = document.getElementById("options");
      choicesDiv.innerHTML = '';
      document.getElementById("result").textContent = '';

      data.options.forEach((choice, index) => {

        const button = document.createElement("button");
        button.textContent = choice;
        button.classList.add("option-button");

        if(savedAnswers[date]){
          button.disabled = true;
          button.classList.add("disabled");

          if(choice === savedAnswers[date]){
            if(choice === data.answer){
              document.getElementById("result").textContent = "Correct!";
              button.classList.add("correct");

            } else {

              document.getElementById("result").textContent = "Wrong! The correct answer was: " + data.answer;
              button.classList.add("wrong");
              
            }
          }
        }

        button.onclick = () => {

          if(savedAnswers[date]) return;

          savedAnswers[date] = choice;
          localStorage.setItem("answers", JSON.stringify(savedAnswers));

          if(choice === data.answer){

            document.getElementById("result").textContent = "Correct!";
            button.classList.add("correct");

            correctCount++;
            localStorage.setItem("correctCount", correctCount);
            document.getElementById("correctCount").textContent = correctCount;

          } else {

            document.getElementById("result").textContent = "Wrong! The correct answer was: " + data.answer;
            button.classList.add("wrong");

            incorrectCount++;
            localStorage.setItem("incorrectCount", incorrectCount);
            document.getElementById("incorrectCount").textContent = incorrectCount;
          }

          document.querySelectorAll('#options button').forEach(button => {
            button.disabled = true;
            button.classList.add("disabled");
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

function loadArchive() {
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

loadData(selectedDate);

if (window.location.pathname.endsWith('archive.html')) {
  loadArchive();
}