<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>学院管理</span>
          <el-button type="primary" @click="openDialog()">
            <el-icon><Plus /></el-icon> 新增学院
          </el-button>
        </div>
      </template>
      <el-table :data="list" stripe v-loading="loading" row-key="id">
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="name" label="学院名称" min-width="150" />
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="班级数" width="80">
          <template #default="{ row }">{{ row.classCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="排序" width="120" align="center">
          <template #default="{ row, $index }">
            <div class="sort-buttons">
              <el-button 
                size="small" 
                :icon="ArrowUp" 
                :disabled="$index === 0"
                @click="handleMoveUp(row, $index)"
                circle
                title="上移"
              />
              <el-button 
                size="small" 
                :icon="ArrowDown" 
                :disabled="$index === list.length - 1"
                @click="handleMoveDown(row, $index)"
                circle
                title="下移"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
            <el-popconfirm title="确定删除？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button size="small" type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑学院' : '新增学院'" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="学院名称" required>
          <el-input v-model="form.name" placeholder="请输入学院名称" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="form.code" placeholder="请输入编码（可选）" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" placeholder="请输入描述信息（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { getColleges, createCollege, updateCollege, deleteCollege } from '../../api/college'
import { useCrudList } from '../../composables/useCrudList'

const {
  list, loading, dialogVisible, saving, form,
  handleMoveUp, handleMoveDown,
  openDialog, handleSave, handleDelete,
} = useCrudList(
  { list: getColleges, create: createCollege, update: updateCollege, remove: deleteCollege },
  { nameLabel: '学院名称' }
)
</script>
