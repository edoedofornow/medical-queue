// server.js  (aligned with front‑end routes)

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

// ───────────────────────────────────── config
const PORT      = process.env.PORT || 3000;
const NODE_ENV  = process.env.NODE_ENV || 'development';
const corsOpts  = {
  origin: [
    'https://your-render-app.onrender.com',
    'http://localhost:3000'
  ],
  optionsSuccessStatus: 200
};

// ───────────────────────────────────── middleware
app.use(cors(corsOpts));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ───────────────────────────────────── queue state
let queue           = [];
let currentPosition = 0;
let calledCustomer  = null;
let previousPatients = [];
const clinicName    = 'Dr Maher Mahmoud Clinics';

function sortQueue () {
  const lvl = { emergency:4, priority:3, elderly:2, normal:1 };
  queue.sort((a,b)=>
    lvl[b.priority]-lvl[a.priority] ||
    new Date(a.timestamp)-new Date(b.timestamp)
  );
}

// ───────────────────────────────────── helpers
function validatePriority(p){
  return ['emergency','priority','elderly','normal'].includes(p);
}

// ───────────────────────────────────── routes

// GET queue state
app.get('/api/queue', (req,res)=>{
  res.json({ queue, currentPosition, calledCustomer, clinicName });
});

// POST add patient
app.post('/api/queue', (req,res)=>{
  const { name, priority='normal', notes='' } = req.body;
  if(!name) return res.status(400).json({ error:'Name required' });
  if(!validatePriority(priority))
    return res.status(400).json({ error:'Invalid priority' });

  const newPatient = {
    name,
    ticket:`P-${(queue.length+1).toString().padStart(3,'0')}`,
    status:'waiting',
    priority,
    notes,
    timestamp:new Date().toISOString(),
    queueTime:new Date().toLocaleTimeString()
  };
  queue.push(newPatient); sortQueue();
  res.status(201).json({ message:'Patient added', patient:newPatient });
});

// PUT update patient
app.put('/api/queue/:idx', (req,res)=>{
  const idx = +req.params.idx;
  if(idx<0||idx>=queue.length) return res.status(400).json({ error:'Bad index' });

  const { name, priority, notes } = req.body;
  if(!name) return res.status(400).json({ error:'Name required' });
  if(priority && !validatePriority(priority))
    return res.status(400).json({ error:'Invalid priority' });

  queue[idx] = { ...queue[idx], name, priority:priority||queue[idx].priority, notes };
  sortQueue();
  res.json({ message:'Patient updated', patient:queue[idx] });
});

// DELETE patient
app.delete('/api/queue/:idx', (req,res)=>{
  const idx = +req.params.idx;
  if(idx<0||idx>=queue.length) return res.status(400).json({ error:'Bad index' });

  const removed = queue.splice(idx,1)[0];
  if(idx<currentPosition) currentPosition--;
  res.json({ message:'Patient removed', patient:removed });
});

// POST call
app.post('/api/queue/call', (req,res)=>{
  if(!queue.length || currentPosition>=queue.length)
    return res.status(400).json({ error:'No patients to call' });

  calledCustomer = queue[currentPosition].name;
  queue[currentPosition].status='serving';
  res.json({ message:`Called ${calledCustomer}`, calledCustomer });
});

// POST next
app.post('/api/queue/next', (req,res)=>{
  if(currentPosition >= queue.length-1)
    return res.status(400).json({ error:'No next patient' });

  // log previous
  previousPatients.push({ ...queue[currentPosition], served:new Date().toISOString() });
  currentPosition++; calledCustomer=null;
  res.json({ message:'Moved to next', currentPosition });
});

// POST previous
app.post('/api/queue/previous', (req,res)=>{
  if(!previousPatients.length)
    return res.status(400).json({ error:'No previous patient' });

  const last = previousPatients.pop();
  currentPosition = queue.findIndex(p=>p.name===last.name);
  if(currentPosition===-1) return res.status(400).json({ error:'Patient not found' });

  calledCustomer = last.name;
  queue[currentPosition].status='serving';
  res.json({ message:`Returned to ${calledCustomer}`, currentPosition });
});

// POST clear
app.post('/api/queue/clear', (req,res)=>{
  queue=[]; currentPosition=0; calledCustomer=null; previousPatients=[];
  res.json({ message:'Queue cleared' });
});

// Health
app.get('/health',(req,res)=>res.json({ status:'OK', env:NODE_ENV, time:new Date().toISOString() }));

// ───────────────────────────────────── start
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
