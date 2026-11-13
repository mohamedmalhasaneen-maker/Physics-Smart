import React, { useState } from 'react';
import { Language, Lesson, LessonProgress, StudyLanguage, StudyTask, UserProfile } from '../types/physics';
import { pickStudyText } from '../lib/bilingual';
import { Calendar, Plus, Sparkles, Trash2 } from 'lucide-react';

interface StudyPlannerViewProps {
  lang: Language;
  studyLang: StudyLanguage;
  profile: UserProfile;
  lessons: Lesson[];
  progressMap: Record<string, LessonProgress>;
  tasks: StudyTask[];
  onSaveTask: (task: StudyTask) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
}

export function StudyPlannerView({
  lang,
  studyLang,
  profile,
  lessons,
  progressMap,
  tasks,
  onSaveTask,
  onDeleteTask,
}: StudyPlannerViewProps) {
  const scopedLessons = lessons.filter((l) => l.track === profile.track && l.grade === profile.grade);
  const weakLessons = scopedLessons.filter((l) => {
    const p = progressMap[l.id];
    return p && p.quizScore > 0 && p.quizScore < 75;
  });

  const [title, setTitle] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationMinutes, setDurationMinutes] = useState(40);
  const [taskType, setTaskType] = useState<'study' | 'practice' | 'review' | 'exam'>('study');
  const [lessonId, setLessonId] = useState('');

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onSaveTask({
      id: `task-${Date.now()}`,
      userId: profile.uid,
      title: title.trim(),
      track: profile.track === 'unset' ? 'thanawiya' : profile.track,
      lessonId: lessonId || undefined,
      scheduledDate,
      durationMinutes,
      taskType,
      completed: false,
    });
    setTitle('');
  };

  const generateSmartPlan = async () => {
    const today = new Date();
    const uncompleted = scopedLessons.filter((l) => !progressMap[l.id]?.isCompleted);
    const targets = [...weakLessons, ...uncompleted].slice(0, 3);

    for (let i = 0; i < targets.length; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const l = targets[i];
      const isWeak = weakLessons.some((w) => w.id === l.id);
      const reviewPrefix = isWeak
        ? studyLang === 'en'
          ? 'Review: '
          : studyLang === 'ar'
            ? 'مراجعة: '
            : 'مراجعة / Review: '
        : '';
      await onSaveTask({
        id: `task-auto-${Date.now()}-${i}`,
        userId: profile.uid,
        title: `${reviewPrefix}${pickStudyText(l.titleAr, l.titleEn, studyLang)}`,
        track: profile.track === 'unset' ? 'thanawiya' : profile.track,
        lessonId: l.id,
        scheduledDate: d.toISOString().slice(0, 10),
        durationMinutes: l.estimatedMinutes || 35,
        taskType: isWeak ? 'review' : 'study',
        completed: false,
      });
    }
  };

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="glass-card rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="glass-icon glass-icon-cyan w-10 h-10 shrink-0">
            <Calendar className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">
              {lang === 'ar' ? 'خطة المذاكرة الذكية' : 'Smart Physics Study Planner'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {lang === 'ar'
                ? 'جدول يومي وأسبوعي يتكيف مع مستواك ويقترح مراجعة الدروس التي تحتاج دعمًا.'
                : 'Daily and weekly schedule tailored to your curriculum and weak-area review needs.'}
            </p>
          </div>
        </div>

        <button
          onClick={generateSmartPlan}
          className="glass-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          {lang === 'ar' ? 'توليد خطة أوتوماتيكية لأدائك' : 'Auto-Generate Smart Plan'}
        </button>
      </div>

      {/* Add Task Form */}
      <form
        onSubmit={handleAddTask}
        className="glass-card rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
      >
        <div className="sm:col-span-4">
          <label className="block text-xs font-medium mb-1">{lang === 'ar' ? 'عنوان المهمة' : 'Task Title'}</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={lang === 'ar' ? 'مثال: حل 15 مسألة على قانون أوم' : 'e.g., Solve 15 Ohm’s Law problems'}
            className="glass-input w-full px-3 py-2 rounded-xl text-xs"
          />
        </div>
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium mb-1">{lang === 'ar' ? 'الدرس المرتبط' : 'Linked Lesson'}</label>
          <select
            value={lessonId}
            onChange={(e) => setLessonId(e.target.value)}
            className="glass-input w-full px-3 py-2 rounded-xl text-xs"
          >
            <option value="">{lang === 'ar' ? 'اختياري' : 'Optional'}</option>
            {scopedLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {pickStudyText(l.titleAr, l.titleEn, studyLang)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium mb-1">{lang === 'ar' ? 'التاريخ' : 'Date'}</label>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="glass-input w-full px-2.5 py-2 rounded-xl text-xs font-mono-num"
          />
        </div>
        <div className="sm:col-span-1">
          <label className="block text-xs font-medium mb-1">{lang === 'ar' ? 'المدة' : 'Min'}</label>
          <input
            type="number"
            min={5}
            max={300}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(+e.target.value)}
            className="glass-input w-full px-2 py-2 rounded-xl text-xs font-mono-num"
          />
        </div>
        <div className="sm:col-span-2 flex gap-2">
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as any)}
            className="glass-input flex-1 px-2 py-2 rounded-xl text-xs"
          >
            <option value="study">{lang === 'ar' ? 'مذاكرة' : 'Study'}</option>
            <option value="practice">{lang === 'ar' ? 'تدريب' : 'Practice'}</option>
            <option value="review">{lang === 'ar' ? 'مراجعة' : 'Review'}</option>
            <option value="exam">{lang === 'ar' ? 'امتحان' : 'Exam'}</option>
          </select>
          <button type="submit" className="glass-btn-primary px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Tasks List */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2.5">
            <span className="glass-icon glass-icon-blue w-8 h-8">
              <Calendar className="w-4 h-4" />
            </span>
            {lang === 'ar' ? 'المهام المجدولة' : 'Scheduled Study Tasks'}
          </h2>
          <span className="text-xs font-mono-num text-slate-600 dark:text-slate-400">
            {completedCount} / {tasks.length} {lang === 'ar' ? 'مكتمل' : 'completed'}
          </span>
        </div>

        {tasks.length === 0 ? (
          <div className="glass-subcard rounded-xl p-5 text-sm text-slate-500 dark:text-slate-400">
            {lang === 'ar' ? 'أضف مهمة يدويًا أو اضغط توليد خطة أوتوماتيكية.' : 'Add a task above or click Auto-Generate Smart Plan.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => (
              <div key={task.id} className="glass-subcard rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => onSaveTask({ ...task, completed: !task.completed })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${task.completed ? 'line-through text-slate-400' : ''}`}>
                      {task.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                      {task.scheduledDate} · {task.durationMinutes} min · {task.taskType}
                    </p>
                  </div>
                </label>
                <button
                  onClick={() => onDeleteTask(task.id)}
                  className="text-slate-400 hover:text-rose-500 transition-colors shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
